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
	UsageReport    time.Duration
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
			// Daily. Periods are reported at close, so this has at most one
			// period per tenant to act on and is a no-op the rest of the month;
			// running it often simply shortens the delay after a period ends.
			UsageReport: envDurationMinutes("WORKER_USAGE_REPORT_INTERVAL_MINUTES", 24*60),
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

// Request body ceilings for the worker's HTTP surface. Every handler bounds the
// body before decoding JSON or touching the database, so these are the first
// limit on decode-and-store amplification: a large body is decoded, stored as
// JSONB, and fans out into secondary writes, which makes payload size both an
// attack and a cost vector at burst rates.
//
// They were previously eight magic numbers spread across five files with no
// stated rationale and no way to change them without a code deploy. The right
// ceiling is deployment-specific — it depends on what a tenant's agents
// actually send — so these are tunable, and the defaults deliberately preserve
// the existing behaviour. Lowering them is a separate, data-led change: pick
// the number from observed payload sizes, not from a guess, because a limit set
// below real traffic rejects legitimate evidence.
const (
	// Control-plane messages with a small fixed shape: gateway claim and
	// resolve, token refresh.
	defaultControlBodyBytes = 1 << 20
	// The runtime hot path the amplification finding is about: evidence
	// ingest, gateway decide, gateway ingest, trust context budget.
	defaultRuntimeBodyBytes = 2 << 20
	// The generic evidence adapter accepts arbitrary customer JSON/NDJSON and
	// is intentionally the most permissive.
	defaultGenericBodyBytes = 3 << 20
)

// BodyLimits holds the resolved per-tier ceilings in bytes.
type BodyLimits struct {
	Control int64
	Runtime int64
	Generic int64
}

// loadBodyLimits resolves the ceilings from the environment once at startup.
// Exposed as a function rather than inlined into the package var so tests can
// exercise the override parsing.
func loadBodyLimits() BodyLimits {
	return BodyLimits{
		Control: int64(envInt("WORKER_MAX_CONTROL_BODY_BYTES", defaultControlBodyBytes)),
		Runtime: int64(envInt("WORKER_MAX_RUNTIME_BODY_BYTES", defaultRuntimeBodyBytes)),
		Generic: int64(envInt("WORKER_MAX_GENERIC_BODY_BYTES", defaultGenericBodyBytes)),
	}
}

var bodyLimits = loadBodyLimits()
