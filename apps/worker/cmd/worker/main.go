package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spctre/spctre/apps/worker/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := worker.LoadConfig()
	if cfg.DatabaseURL == "" {
		logger.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		logger.Error("database config failed", "error", err)
		os.Exit(1)
	}
	poolConfig.MaxConns = cfg.DBPoolMaxConns
	db, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		logger.Error("database pool failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(ctx); err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}

	server := worker.NewServer(db, logger, cfg.Notification)
	var jobsDone *sync.WaitGroup
	if !cfg.DisableInternalScheduler {
		// The in-process ticker takes no advisory lock — only the /internal/jobs
		// endpoints do (runJobEndpoint). Nothing coordinates tickers across
		// processes, so every replica runs every sweep on its own schedule.
		// For the convergent sweeps that is wasted work; for the ones with
		// external side effects it is duplicated delivery.
		//
		// A single replica is unaffected, which is why this is a warning rather
		// than a refusal to start: it is the correct configuration for a
		// single-instance or local deployment, and the wrong one the moment the
		// worker is scaled.
		logger.Warn("internal scheduler enabled; safe for a single worker replica only",
			"detail", "the in-process ticker holds no cross-process lock, so each replica runs every job independently",
			"remedy", "when running more than one replica, set SPCTRE_DISABLE_INTERNAL_SCHEDULER=1 and drive POST /internal/jobs/* from an external scheduler, which does take a per-job advisory lock")
		jobsDone = worker.StartJobs(ctx, db, worker.Jobs(db, logger, cfg.JobInterval, cfg.Notification), logger)
	} else {
		logger.Info("internal scheduler disabled; job endpoints available for external triggers")
	}
	server.MarkReady()

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           server.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("worker http server listening", "addr", cfg.HTTPAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("worker http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("worker http shutdown failed", "error", err)
	}
	// Drain in-flight side-effect goroutines (ops log writes and trust
	// ingests, notification dispatches) before the process exits.
	server.Wait()
	if jobsDone != nil {
		jobsDone.Wait()
	}
	logger.Info("worker shut down")
}
