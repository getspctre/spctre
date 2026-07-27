package worker

import "testing"

func TestLoadConfigDefaultHTTPPort(t *testing.T) {
	t.Setenv("WORKER_HTTP_PORT", "")

	cfg := LoadConfig()
	if cfg.HTTPAddr != ":18080" {
		t.Fatalf("HTTPAddr = %q, want :18080", cfg.HTTPAddr)
	}
}

func TestLoadConfigHTTPPortOverride(t *testing.T) {
	t.Setenv("WORKER_HTTP_PORT", "19090")

	cfg := LoadConfig()
	if cfg.HTTPAddr != ":19090" {
		t.Fatalf("HTTPAddr = %q, want :19090", cfg.HTTPAddr)
	}
}
