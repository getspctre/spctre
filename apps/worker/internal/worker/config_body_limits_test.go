package worker

import "testing"

func TestBodyLimitsDefaultsPreserveExistingCeilings(t *testing.T) {
	limits := loadBodyLimits()
	if limits.Control != 1<<20 {
		t.Fatalf("control limit = %d, want %d", limits.Control, 1<<20)
	}
	if limits.Runtime != 2<<20 {
		t.Fatalf("runtime limit = %d, want %d", limits.Runtime, 2<<20)
	}
	if limits.Generic != 3<<20 {
		t.Fatalf("generic limit = %d, want %d", limits.Generic, 3<<20)
	}
}

func TestBodyLimitsHonourEnvironmentOverrides(t *testing.T) {
	t.Setenv("WORKER_MAX_CONTROL_BODY_BYTES", "4096")
	t.Setenv("WORKER_MAX_RUNTIME_BODY_BYTES", "8192")
	t.Setenv("WORKER_MAX_GENERIC_BODY_BYTES", "16384")

	limits := loadBodyLimits()
	if limits.Control != 4096 || limits.Runtime != 8192 || limits.Generic != 16384 {
		t.Fatalf("overrides not applied: %+v", limits)
	}
}

// An operator lowering a ceiling must not be able to disable body limits
// entirely: MaxBytesReader with 0 rejects every request, and a negative value
// is meaningless. envInt already falls back on non-positive input; this pins
// that behaviour to the body-limit path so a typo degrades to the default
// rather than taking an endpoint offline.
func TestBodyLimitsRejectNonPositiveOverrides(t *testing.T) {
	for _, raw := range []string{"0", "-1", "not-a-number", ""} {
		t.Setenv("WORKER_MAX_RUNTIME_BODY_BYTES", raw)
		if limits := loadBodyLimits(); limits.Runtime != 2<<20 {
			t.Fatalf("override %q gave runtime limit %d, want the default %d", raw, limits.Runtime, 2<<20)
		}
	}
}
