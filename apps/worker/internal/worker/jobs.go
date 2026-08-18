package worker

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Job struct {
	Name  string
	Every time.Duration
	Run   func(context.Context) error
}

func Jobs(db *pgxpool.Pool, logger *slog.Logger, intervals JobIntervals, notifications NotificationConfig) []Job {
	jobs := []Job{
		{Name: "evidence-retention", Every: intervals.Retention, Run: func(ctx context.Context) error {
			return runRetention(ctx, db, logger)
		}},
		{Name: "verification-sweep", Every: intervals.Verification, Run: func(ctx context.Context) error {
			return runVerificationSweep(ctx, db, logger)
		}},
		{Name: "metrics-sweep", Every: intervals.Metrics, Run: func(ctx context.Context) error {
			return runMetricsSweep(ctx, db, logger)
		}},
		{Name: "escalation-sla-monitor", Every: intervals.EscalationSLA, Run: func(ctx context.Context) error {
			return runEscalationSLAMonitor(ctx, db, logger)
		}},
	}
	jobs = append(jobs, Job{Name: "notification-sender", Every: intervals.Notification, Run: func(ctx context.Context) error {
		return runNotificationSender(ctx, db, logger, notifications, safeHTTPClient)
	}})
	jobs = append(jobs, Job{Name: "siem-forwarder", Every: intervals.SiemForwarder, Run: func(ctx context.Context) error {
		return runSiemForwarder(ctx, db, logger, safeHTTPClient)
	}})
	jobs = append(jobs, Job{Name: "usage-reconcile", Every: intervals.UsageReconcile, Run: func(ctx context.Context) error {
		return runUsageReconciliation(ctx, db, logger)
	}})
	jobs = append(jobs, Job{Name: "usage-report", Every: intervals.UsageReport, Run: func(ctx context.Context) error {
		return runUsageReporting(ctx, db, logger)
	}})
	return jobs
}

// StartJobs launches each job's ticker loop in its own goroutine and returns
// a WaitGroup that unblocks once all loops have exited (i.e. ctx is done).
func StartJobs(ctx context.Context, db *pgxpool.Pool, jobs []Job, logger *slog.Logger) *sync.WaitGroup {
	var wg sync.WaitGroup
	for _, job := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			runJob(ctx, db, job, logger)
			ticker := time.NewTicker(job.Every)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					runJob(ctx, db, job, logger)
				}
			}
		}()
	}
	return &wg
}

func runJob(ctx context.Context, db *pgxpool.Pool, job Job, logger *slog.Logger) {
	started := time.Now()
	// The ticker previously took no lock of any kind, so every replica running
	// it ran every sweep independently. The lease is what makes this path
	// exclusive, and it is the same one the HTTP endpoints take.
	ran, err := runWithJobLease(ctx, db, logger, job.Name, TriggerTicker, job.Run)
	if !ran {
		if err != nil {
			logger.Error("worker job could not acquire its lease", "worker.job.name", job.Name, "error", err)
			return
		}
		logger.Info("worker job skipped; lease held elsewhere", "worker.job.name", job.Name)
		return
	}
	if err != nil {
		logger.Error("worker job failed", "worker.job.name", job.Name, "error", err, "duration_ms", time.Since(started).Milliseconds())
		return
	}
	logger.Info("worker job complete", "worker.job.name", job.Name, "duration_ms", time.Since(started).Milliseconds())
}
