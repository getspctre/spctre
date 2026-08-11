package worker

import (
	"os"
	"strconv"
	"time"
)

const (
	DefaultComplianceRetentionDays = 90
	VerificationStaleDays          = 7
)

type Config struct {
	DatabaseURL              string
	HTTPAddr                 string
	JobInterval              JobIntervals
	Notification             NotificationConfig
	DisableInternalScheduler bool
	DBPoolMaxConns           int32
}

type JobIntervals struct {
	Retention      time.Duration
	Verification   time.Duration
	Metrics        time.Duration
	EscalationSLA  time.Duration
	Notification   time.Duration
	SiemForwarder  time.Duration
	UsageReconcile time.Duration
}

type NotificationConfig struct {
	WebhookURL string
	Timeout    time.Duration
	// MaxAttempts bounds cross-sweep delivery attempts per notification;
	// after this many NOTIFICATION_FAILED entries the event is dead-lettered.
	MaxAttempts int
}

const defaultNotificationMaxAttempts = 5

func LoadConfig() Config {
	return Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		HTTPAddr:    ":" + envString("WORKER_HTTP_PORT", "18080"),
		JobInterval: JobIntervals{
			Retention:     envDurationMinutes("WORKER_RETENTION_INTERVAL_MINUTES", 24*60),
			Verification:  envDurationMinutes("WORKER_VERIFICATION_INTERVAL_MINUTES", 6*60),
			Metrics:       envDurationSeconds("WORKER_METRICS_INTERVAL_SECONDS", 5*60),
			EscalationSLA: envDurationMinutes("WORKER_ESCALATION_SLA_INTERVAL_MINUTES", 5),
			Notification:  envDurationMinutes("WORKER_NOTIFICATION_INTERVAL_MINUTES", 5),
			SiemForwarder: envDurationMinutes("WORKER_SIEM_FORWARDER_INTERVAL_MINUTES", 5),
			// Daily. The gauge is maintained incrementally at ingest and prune,
			// so this is an audit that repairs drift rather than the mechanism
			// that produces the number. It is a full recount, so its cost grows
			// with retained volume — the reason not to run it hourly.
			UsageReconcile: envDurationMinutes("WORKER_USAGE_RECONCILE_INTERVAL_MINUTES", 24*60),
		},
		Notification: NotificationConfig{
			WebhookURL:  os.Getenv("WORKER_NOTIFICATION_WEBHOOK_URL"),
			Timeout:     envDurationSeconds("WORKER_NOTIFICATION_TIMEOUT_SECONDS", 10),
			MaxAttempts: envInt("WORKER_NOTIFICATION_MAX_ATTEMPTS", defaultNotificationMaxAttempts),
		},
		DisableInternalScheduler: envBool("SPCTRE_DISABLE_INTERNAL_SCHEDULER"),
		DBPoolMaxConns:           envDBPoolMaxConns("WORKER_DB_POOL_MAX_CONNS", envBool("SPCTRE_DISABLE_INTERNAL_SCHEDULER")),
	}
}

// envDBPoolMaxConns returns the configured pool size, defaulting to 2 for
// serverless (scale-to-zero) deployments and 10 for long-running ones.
// Keeping the serverless default small avoids connection exhaustion when
// many short-lived instances spin up simultaneously.
func envDBPoolMaxConns(name string, serverless bool) int32 {
	defaultSize := 10
	if serverless {
		defaultSize = 2
	}
	return int32(envInt(name, defaultSize))
}

func envBool(name string) bool {
	raw := os.Getenv(name)
	return raw == "1" || raw == "true" || raw == "yes"
}

func envString(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envDurationMinutes(name string, fallback int) time.Duration {
	return time.Duration(envInt(name, fallback)) * time.Minute
}

func envDurationSeconds(name string, fallback int) time.Duration {
	return time.Duration(envInt(name, fallback)) * time.Second
}

func envInt(name string, fallback int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
