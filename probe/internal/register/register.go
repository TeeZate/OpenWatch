// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package register handles the probe's one-time registration with the platform.
//
// On first start, the probe sends its host fingerprint to POST /api/v1/probe/register.
// The platform binds the fingerprint to the token — all future ingest requests from
// a different machine will be rejected at Check 4 of the validation pipeline.
//
// Registration is idempotent: calling EnsureRegistered when already registered
// returns success (the platform returns status="already_active").
package register

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"openwatch/probe/internal/config"
	"openwatch/probe/internal/fingerprint"
)

type registerRequest struct {
	TokenID         string `json:"token_id"`
	SystemID        string `json:"system_id"`
	HostFingerprint string `json:"host_fingerprint"`
	ProbeVersion    string `json:"probe_version"`
	Hostname        string `json:"hostname"`
}

type registerResponse struct {
	Registered bool   `json:"registered"`
	Status     string `json:"status"`
	SystemID   string `json:"system_id"`
	Message    string `json:"message"`
}

// EnsureRegistered registers this probe with the platform if not already done.
// It is safe to call on every startup — the platform handles idempotency.
func EnsureRegistered(cfg *config.Config, fp, version string) error {
	body := registerRequest{
		TokenID:         cfg.Token.TokenID,
		SystemID:        cfg.Token.SystemID,
		HostFingerprint: fp,
		ProbeVersion:    version,
		Hostname:        fingerprint.Hostname(),
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal registration request: %w", err)
	}

	client := buildHTTPClient(cfg)
	url := strings.TrimRight(cfg.Token.PlatformURL, "/") + "/api/v1/probe/register"

	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		resp, err := client.Post(url, "application/json", bytes.NewReader(bodyBytes))
		if err != nil {
			lastErr = err
			time.Sleep(time.Duration(attempt*2) * time.Second)
			continue
		}
		defer resp.Body.Close()

		respBody, _ := io.ReadAll(resp.Body)

		if resp.StatusCode == http.StatusOK {
			var reg registerResponse
			if err := json.Unmarshal(respBody, &reg); err == nil {
				if reg.Status == "already_active" {
					fmt.Printf("[register] Already registered (same fingerprint). Status: active.\n")
				} else {
					fmt.Printf("[register] Registration successful. Host fingerprint bound to token.\n")
				}
			}
			return nil
		}

		if resp.StatusCode == http.StatusConflict {
			return fmt.Errorf(
				"token %s is already bound to a different host. "+
					"Revoke this token in the OpenWatch dashboard and issue a new one",
				cfg.Token.TokenID,
			)
		}

		if resp.StatusCode == http.StatusUnauthorized {
			return fmt.Errorf("token rejected by platform (revoked or expired): %s", string(respBody))
		}

		lastErr = fmt.Errorf("registration failed with HTTP %d: %s", resp.StatusCode, string(respBody))
		time.Sleep(time.Duration(attempt*2) * time.Second)
	}

	return fmt.Errorf("registration failed after 3 attempts: %w", lastErr)
}

// ── HTTP client ───────────────────────────────────────────────────────────────

func buildHTTPClient(cfg *config.Config) *http.Client {
	tlsCfg := &tls.Config{InsecureSkipVerify: false}

	// Load client certificate if available
	if cfg.CertPEM != "" && cfg.KeyPEM != "" {
		cert, err := tls.X509KeyPair([]byte(cfg.CertPEM), []byte(cfg.KeyPEM))
		if err == nil {
			tlsCfg.Certificates = []tls.Certificate{cert}
		}
	}

	transport := &http.Transport{
		TLSClientConfig:       tlsCfg,
		ResponseHeaderTimeout: 15 * time.Second,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}
}
