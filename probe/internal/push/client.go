// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package push handles signed telemetry delivery to the OpenWatch platform.
//
// The client uses mTLS (application-layer): the probe's client certificate is
// sent in the X-OpenWatch-Client-Cert header on every request.
// The HMAC-SHA256 signature is sent in X-OpenWatch-Signature.
//
// On failure, exponential back-off is applied:
//
//	2s → 4s → 8s → 16s → max 5 minutes
//
// The last 50 payloads are buffered in a ring buffer so they can be replayed
// when connectivity is restored (not yet implemented — Phase 2.1).
package push

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"openwatch/probe/internal/collect"
	"openwatch/probe/internal/config"
)

// Client is a configured HTTP client for pushing telemetry to the platform.
type Client struct {
	cfg        *config.Config
	httpClient *http.Client
	certB64    string // base64-encoded PEM cert for the header
}

// NewClient creates a push client with mTLS configured from the probe config.
// Client cert failure is non-fatal — the probe falls back to HMAC-only auth.
func NewClient(cfg *config.Config) (*Client, error) {
	tlsCfg := &tls.Config{InsecureSkipVerify: false}

	certB64 := ""

	// Load client certificate — non-fatal: HMAC signature still authenticates payloads
	// even without a client cert. This handles cases where the cert env var is missing
	// or malformed (e.g. Railway PEM newline escaping not yet normalized upstream).
	if cfg.CertPEM != "" && cfg.KeyPEM != "" {
		cert, err := tls.X509KeyPair([]byte(cfg.CertPEM), []byte(cfg.KeyPEM))
		if err != nil {
			log.Printf("[push] WARN: client cert/key failed to parse: %v — pushing without mTLS cert (HMAC auth still active)", err)
		} else {
			tlsCfg.Certificates = []tls.Certificate{cert}
			// Encode PEM for header transmission
			certB64 = base64.StdEncoding.EncodeToString([]byte(cfg.CertPEM))
		}
	}

	transport := &http.Transport{
		TLSClientConfig:       tlsCfg,
		ResponseHeaderTimeout: 20 * time.Second,
		MaxIdleConnsPerHost:   2,
	}

	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   30 * time.Second,
		},
		certB64: certB64,
	}, nil
}

// Push sends a signed telemetry payload to /api/v1/ingest/{system_id}.
// The signature parameter is the value of X-OpenWatch-Signature header.
func (c *Client) Push(payload *collect.Payload, signature string) error {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	url := strings.TrimRight(c.cfg.Token.PlatformURL, "/") +
		"/api/v1/ingest/" + c.cfg.Token.SystemID

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	if signature != "" {
		req.Header.Set("X-OpenWatch-Signature", signature)
	}
	if c.certB64 != "" {
		req.Header.Set("X-OpenWatch-Client-Cert", c.certB64)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	switch resp.StatusCode {
	case http.StatusAccepted, http.StatusOK:
		return nil
	case http.StatusUnauthorized:
		return fmt.Errorf("unauthorized (401): %s — token may be revoked or fingerprint mismatch", string(body))
	case http.StatusUnprocessableEntity:
		return fmt.Errorf("validation error (422): %s", string(body))
	default:
		return fmt.Errorf("unexpected HTTP %d: %s", resp.StatusCode, string(body))
	}
}

// PushWithBackoff calls Push with exponential back-off on failure.
// maxAttempts = 0 means try once.
func (c *Client) PushWithBackoff(payload *collect.Payload, signature string, maxAttempts int) error {
	if maxAttempts <= 0 {
		maxAttempts = 1
	}

	var lastErr error
	backoff := 2 * time.Second

	for i := 0; i < maxAttempts; i++ {
		if err := c.Push(payload, signature); err != nil {
			lastErr = err
			if i < maxAttempts-1 {
				time.Sleep(backoff)
				backoff *= 2
				if backoff > 5*time.Minute {
					backoff = 5 * time.Minute
				}
			}
			continue
		}
		return nil
	}

	return fmt.Errorf("push failed after %d attempts: %w", maxAttempts, lastErr)
}
