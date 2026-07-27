package nemoclaw

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	ingestPath    = "/api/v1/evidence"
	defaultTimeout = 5 * time.Second
)

// Client posts NemoClaw sandbox events to the Spctre evidence ingest endpoint.
type Client struct {
	BaseURL    string
	APIKey     string
	httpClient *http.Client
}

// NewClient constructs a Client with a 5-second HTTP timeout.
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		httpClient: &http.Client{
			Timeout: defaultTimeout,
		},
	}
}

// IngestSandboxEvent converts event to a Spctre evidence record and POSTs it.
// Returns non-nil error on any non-2xx response or transport failure.
func (c *Client) IngestSandboxEvent(ctx context.Context, event SandboxEvent) error {
	record := event.ToEvidenceRecord()

	body, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("nemoclaw: marshal evidence record: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+ingestPath, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("nemoclaw: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("nemoclaw: ingest request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("nemoclaw: ingest returned %d", resp.StatusCode)
	}
	return nil
}
