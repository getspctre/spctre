package worker

import (
	"context"
	"testing"
)

// insertSiemStream creates an enabled stream owned by the fixture's tenant.
func (f gatewayFixture) insertSiemStream(t *testing.T, name string) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(context.Background(),
		`INSERT INTO workspace_siem_stream (tenant_id, workspace_id, name, type, url)
		 VALUES ($1, $2, $3, 'SPLUNK_HEC', 'https://example.invalid/services/collector')
		 RETURNING id::text`,
		f.tenantID, f.workspaceID, name,
	).Scan(&id); err != nil {
		t.Fatalf("insert siem stream: %v", err)
	}
	return id
}

type siemState struct {
	failures  int
	enabled   bool
	lastError *string
	suspended bool
}

func (f gatewayFixture) siemState(t *testing.T, id string) siemState {
	t.Helper()
	var s siemState
	if err := f.pool.QueryRow(context.Background(),
		`SELECT consecutive_failures, enabled, last_error, suspended_at IS NOT NULL
		   FROM workspace_siem_stream WHERE id = $1::uuid`, id,
	).Scan(&s.failures, &s.enabled, &s.lastError, &s.suspended); err != nil {
		t.Fatalf("read siem stream: %v", err)
	}
	return s
}

func TestSiemFailuresAccumulateWithoutSuspendingBelowTheCeiling(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	id := f.insertSiemStream(t, "under-ceiling")
	ctx := context.Background()

	for i := 1; i < 3; i++ {
		failures, suspended, err := recordSiemFailure(ctx, pool, id, "connection refused", 3)
		if err != nil {
			t.Fatal(err)
		}
		if failures != i {
			t.Fatalf("after %d failures, count = %d", i, failures)
		}
		if suspended {
			t.Fatalf("suspended at %d of 3 attempts", i)
		}
	}

	state := f.siemState(t, id)
	if !state.enabled {
		t.Fatal("stream must stay enabled below the ceiling")
	}
	if state.suspended {
		t.Fatal("suspended_at must be unset below the ceiling")
	}
	if state.lastError == nil || *state.lastError != "connection refused" {
		t.Fatalf("last_error = %v", state.lastError)
	}
}

func TestSiemFailureAtTheCeilingSuspendsTheStream(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	id := f.insertSiemStream(t, "at-ceiling")
	ctx := context.Background()

	var suspendedOn int
	for i := 1; i <= 3; i++ {
		_, suspended, err := recordSiemFailure(ctx, pool, id, "503 from collector", 3)
		if err != nil {
			t.Fatal(err)
		}
		if suspended && suspendedOn == 0 {
			suspendedOn = i
		}
	}

	if suspendedOn != 3 {
		t.Fatalf("suspended on attempt %d, want 3", suspendedOn)
	}
	state := f.siemState(t, id)
	if state.enabled {
		t.Fatal("a suspended stream must be disabled so the forwarder stops selecting it")
	}
	if !state.suspended {
		t.Fatal("suspended_at must be set, to distinguish this from an operator pause")
	}
}

// The ceiling counts *consecutive* failures: a delivered batch restores the
// full budget, so unrelated failures weeks apart never accumulate into a
// suspension.
func TestSiemSuccessClearsTheFailureStreak(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	id := f.insertSiemStream(t, "recovers")
	ctx := context.Background()

	if _, _, err := recordSiemFailure(ctx, pool, id, "timeout", 3); err != nil {
		t.Fatal(err)
	}
	if _, _, err := recordSiemFailure(ctx, pool, id, "timeout", 3); err != nil {
		t.Fatal(err)
	}
	if err := clearSiemFailures(ctx, pool, id); err != nil {
		t.Fatal(err)
	}

	state := f.siemState(t, id)
	if state.failures != 0 {
		t.Fatalf("failures = %d after success, want 0", state.failures)
	}
	if state.lastError != nil {
		t.Fatalf("last_error = %q after success, want NULL", *state.lastError)
	}

	// A fresh streak must again need the full ceiling.
	_, suspended, err := recordSiemFailure(ctx, pool, id, "timeout", 3)
	if err != nil {
		t.Fatal(err)
	}
	if suspended {
		t.Fatal("one failure after a success must not suspend")
	}
}

// A suspended stream is excluded from the sweep because the forwarder selects
// only enabled rows — that is what stops the infinite replay.
func TestSuspendedStreamIsNotSelectedForForwarding(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	id := f.insertSiemStream(t, "excluded-when-suspended")
	ctx := context.Background()

	before, err := listSiemStreams(ctx, pool, "")
	if err != nil {
		t.Fatal(err)
	}
	if !containsStream(before, id) {
		t.Fatal("expected the enabled stream to be listed")
	}

	for i := 0; i < 3; i++ {
		if _, _, err := recordSiemFailure(ctx, pool, id, "gone", 3); err != nil {
			t.Fatal(err)
		}
	}

	after, err := listSiemStreams(ctx, pool, "")
	if err != nil {
		t.Fatal(err)
	}
	if containsStream(after, id) {
		t.Fatal("a suspended stream must not be selected for forwarding")
	}
}

// Suspension must not move the cursor: re-enabling has to resume from the last
// acknowledged event, or suspending would silently drop the pending batch.
func TestSuspensionLeavesTheCursorUntouched(t *testing.T) {
	pool := testGatewayDB(t)
	f := newGatewayFixture(t, pool)
	id := f.insertSiemStream(t, "cursor-preserved")
	ctx := context.Background()

	if _, err := pool.Exec(ctx,
		`UPDATE workspace_siem_stream SET last_forwarded_id = 'evt-42' WHERE id = $1::uuid`, id,
	); err != nil {
		t.Fatal(err)
	}

	for i := 0; i < 3; i++ {
		if _, _, err := recordSiemFailure(ctx, pool, id, "gone", 3); err != nil {
			t.Fatal(err)
		}
	}

	var cursor *string
	if err := pool.QueryRow(ctx,
		`SELECT last_forwarded_id FROM workspace_siem_stream WHERE id = $1::uuid`, id,
	).Scan(&cursor); err != nil {
		t.Fatal(err)
	}
	if cursor == nil || *cursor != "evt-42" {
		t.Fatalf("cursor = %v, want evt-42 preserved across suspension", cursor)
	}
}

func containsStream(streams []siemStream, id string) bool {
	for _, s := range streams {
		if s.ID == id {
			return true
		}
	}
	return false
}
