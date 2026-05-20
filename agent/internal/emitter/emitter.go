// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

package emitter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

const ingestPath = "/api/v1/ingest"

// Emitter sends agent events to the OpenWatch backend.
// If BackendURL is empty it prints to stdout instead (dev mode).
type Emitter struct {
	backendURL string
	agentID    string
	client     *http.Client
	maxRetries int
}

// Config holds Emitter configuration.
type Config struct {
	BackendURL string
	AgentID    string
	Timeout    time.Duration // per-attempt timeout; default 5s
	MaxRetries int           // default 3
}

// New creates an Emitter from the given config.
func New(cfg Config) *Emitter {
	if cfg.Timeout == 0 {
		cfg.Timeout = 5 * time.Second
	}
	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 3
	}
	return &Emitter{
		backendURL: cfg.BackendURL,
		agentID:    cfg.AgentID,
		client:     &http.Client{Timeout: cfg.Timeout},
		maxRetries: cfg.MaxRetries,
	}
}

// Send marshals v to JSON and POSTs it to the backend ingest endpoint.
// Retries up to MaxRetries times with exponential backoff on network errors
// or 5xx responses. Falls back to stdout if no BackendURL is configured.
func (e *Emitter) Send(ctx context.Context, v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("emitter: marshal: %w", err)
	}

	if e.backendURL == "" {
		return stdoutFallback(body)
	}

	url := e.backendURL + ingestPath
	var lastErr error

	for attempt := 0; attempt < e.maxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second // 1s, 2s, 4s
			log.Printf("emitter: retry %d/%d in %s", attempt+1, e.maxRetries, backoff)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}

		lastErr = e.post(ctx, url, body)
		if lastErr == nil {
			return nil
		}

		// Only retry on network errors or 5xx; bail immediately on 4xx.
		if isClientError(lastErr) {
			return lastErr
		}
		log.Printf("emitter: send attempt %d failed: %v", attempt+1, lastErr)
	}

	return fmt.Errorf("emitter: all %d attempts failed: %w", e.maxRetries, lastErr)
}

func (e *Emitter) post(ctx context.Context, url string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-ID", e.agentID)

	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return &httpError{StatusCode: resp.StatusCode}
	}
	return nil
}

// httpError carries an HTTP status code so callers can distinguish 4xx from 5xx.
type httpError struct {
	StatusCode int
}

func (e *httpError) Error() string {
	return fmt.Sprintf("http %d", e.StatusCode)
}

// isClientError returns true for 4xx status codes (do not retry).
func isClientError(err error) bool {
	if he, ok := err.(*httpError); ok {
		return he.StatusCode >= 400 && he.StatusCode < 500
	}
	return false
}

// stdoutFallback pretty-prints the JSON payload when no backend is configured.
func stdoutFallback(body []byte) error {
	var buf bytes.Buffer
	if err := json.Indent(&buf, body, "", "  "); err != nil {
		fmt.Println(string(body))
		return nil
	}
	fmt.Println(buf.String())
	return nil
}
