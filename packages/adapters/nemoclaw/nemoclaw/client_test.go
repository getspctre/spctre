package nemoclaw_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getspctre/spctre/packages/adapters/nemoclaw/nemoclaw"
)

func baseEvent() nemoclaw.SandboxEvent {
	return nemoclaw.SandboxEvent{
		EventType:    "SANDBOX_ACTION",
		AgentID:      "agent-1",
		TenantID:     "tenant-1",
		WorkspaceID:  "ws-1",
		SandboxName:  "sandbox-alpha",
		Layer:        "INFRASTRUCTURE",
		ActionKind:   "file_write",
		ResourcePath: "/etc/hosts",
		Outcome:      "allowed",
		PolicyRef:    "policy-abc",
		EmittedAt:    time.Now().UTC(),
	}
}

func TestIngestSandboxEvent(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		cancelCtx  bool
		wantErr    bool
	}{
		{
			name:       "successful ingest returns nil",
			statusCode: http.StatusOK,
			wantErr:    false,
		},
		{
			name:       "201 Created also succeeds",
			statusCode: http.StatusCreated,
			wantErr:    false,
		},
		{
			name:       "non-2xx response returns error",
			statusCode: http.StatusInternalServerError,
			wantErr:    true,
		},
		{
			name:       "401 unauthorized returns error",
			statusCode: http.StatusUnauthorized,
			wantErr:    true,
		},
		{
			name:      "context cancellation propagates",
			cancelCtx: true,
			wantErr:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") == "" {
					t.Error("missing Authorization header")
				}
				if r.Header.Get("Content-Type") != "application/json" {
					t.Errorf("unexpected Content-Type: %s", r.Header.Get("Content-Type"))
				}
				if tc.cancelCtx {
					// block until the client gives up
					select {
					case <-r.Context().Done():
					case <-time.After(5 * time.Second):
					}
					return
				}
				w.WriteHeader(tc.statusCode)
			}))
			defer srv.Close()

			client := nemoclaw.NewClient(srv.URL, "test-key")

			ctx := context.Background()
			var cancel context.CancelFunc
			if tc.cancelCtx {
				ctx, cancel = context.WithTimeout(ctx, 10*time.Millisecond)
				defer cancel()
			}

			err := client.IngestSandboxEvent(ctx, baseEvent())
			if (err != nil) != tc.wantErr {
				t.Errorf("wantErr=%v, got err=%v", tc.wantErr, err)
			}
		})
	}
}

func TestToEvidenceRecord(t *testing.T) {
	t.Run("allowed outcome maps to ALLOW status", func(t *testing.T) {
		ev := baseEvent()
		ev.Outcome = "allowed"
		rec := ev.ToEvidenceRecord()
		if rec.Status != "ALLOW" {
			t.Errorf("expected ALLOW, got %s", rec.Status)
		}
		if rec.RuntimeTarget.Stack != "NEMOCLAW" {
			t.Errorf("expected NEMOCLAW stack, got %s", rec.RuntimeTarget.Stack)
		}
		if rec.Layer != "sandbox" {
			t.Errorf("expected sandbox layer, got %s", rec.Layer)
		}
	})

	t.Run("blocked outcome maps to DENY status", func(t *testing.T) {
		ev := baseEvent()
		ev.Outcome = "blocked"
		rec := ev.ToEvidenceRecord()
		if rec.Status != "DENY" {
			t.Errorf("expected DENY, got %s", rec.Status)
		}
	})

	t.Run("sandboxName is propagated to runtimeTarget", func(t *testing.T) {
		ev := baseEvent()
		ev.SandboxName = "my-sandbox"
		rec := ev.ToEvidenceRecord()
		if rec.RuntimeTarget.SandboxName != "my-sandbox" {
			t.Errorf("expected sandboxName=my-sandbox, got %q", rec.RuntimeTarget.SandboxName)
		}
	})

	t.Run("required contract fields are populated", func(t *testing.T) {
		ev := baseEvent()
		rec := ev.ToEvidenceRecord()
		if rec.DecisionID == "" {
			t.Error("decisionId must not be empty")
		}
		if rec.Environment == "" {
			t.Error("environment must not be empty")
		}
		if rec.Connector == "" {
			t.Error("connector must not be empty")
		}
		if rec.Reason == "" {
			t.Error("reason must not be empty")
		}
		if rec.IngestMode != "gateway" {
			t.Errorf("expected ingestMode=gateway, got %q", rec.IngestMode)
		}
	})

	t.Run("environment defaults to production when empty", func(t *testing.T) {
		ev := baseEvent()
		ev.Environment = ""
		rec := ev.ToEvidenceRecord()
		if rec.Environment != "production" {
			t.Errorf("expected production, got %q", rec.Environment)
		}
	})

	t.Run("environment is preserved when set", func(t *testing.T) {
		ev := baseEvent()
		ev.Environment = "staging"
		rec := ev.ToEvidenceRecord()
		if rec.Environment != "staging" {
			t.Errorf("expected staging, got %q", rec.Environment)
		}
	})

	t.Run("connector falls back to nemoclaw when sandboxName is empty", func(t *testing.T) {
		ev := baseEvent()
		ev.SandboxName = ""
		rec := ev.ToEvidenceRecord()
		if rec.Connector != "nemoclaw" {
			t.Errorf("expected nemoclaw connector, got %q", rec.Connector)
		}
	})
}
