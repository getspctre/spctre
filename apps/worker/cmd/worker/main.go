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
		jobsDone = worker.StartJobs(ctx, worker.Jobs(db, logger, cfg.JobInterval, cfg.Notification), logger)
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
