// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package collect — synthetic frontend URL monitoring.
// Makes HTTP GET requests to a list of URLs and records status code,
// latency, redirect chain length and any connection errors.

package collect

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

type SyntheticResult struct {
	Name       string  `json:"name"`
	URL        string  `json:"url"`
	Status     string  `json:"status"`               // "up" | "degraded" | "down"
	StatusCode int     `json:"status_code,omitempty"` // HTTP status code
	LatencyMS  float64 `json:"latency_ms"`
	Redirects  int     `json:"redirects,omitempty"`
	Error      string  `json:"error,omitempty"`
}

// ── Collector ─────────────────────────────────────────────────────────────────

var syntheticClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: false}, // strict TLS for frontend
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	},
}

// CollectSynthetics checks each URL and returns one result per URL.
// name is derived from the URL hostname if not explicitly set.
func CollectSynthetics(rawURLs []string) []SyntheticResult {
	if len(rawURLs) == 0 {
		return nil
	}
	results := make([]SyntheticResult, 0, len(rawURLs))
	for _, raw := range rawURLs {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		results = append(results, checkSynthetic(raw))
	}
	return results
}

func checkSynthetic(rawURL string) SyntheticResult {
	name := labelFromURL(rawURL)
	start := time.Now()

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return SyntheticResult{
			Name:   name,
			URL:    rawURL,
			Status: "down",
			Error:  fmt.Sprintf("invalid URL: %v", err),
		}
	}
	req.Header.Set("User-Agent", "OpenWatch-Probe/1.0 (synthetic)")

	redirectCount := 0
	origTransport := syntheticClient.CheckRedirect
	client := *syntheticClient
	client.CheckRedirect = func(r *http.Request, via []*http.Request) error {
		redirectCount = len(via)
		return origTransport(r, via)
	}

	resp, err := client.Do(req)
	latency := float64(time.Since(start).Microseconds()) / 1000.0

	if err != nil {
		return SyntheticResult{
			Name:      name,
			URL:       rawURL,
			Status:    "down",
			LatencyMS: round2(latency),
			Error:     err.Error(),
		}
	}
	defer resp.Body.Close()

	status := "up"
	if resp.StatusCode >= 500 {
		status = "down"
	} else if resp.StatusCode >= 400 {
		status = "degraded"
	}

	return SyntheticResult{
		Name:       name,
		URL:        rawURL,
		Status:     status,
		StatusCode: resp.StatusCode,
		LatencyMS:  round2(latency),
		Redirects:  redirectCount,
	}
}

func labelFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return rawURL
	}
	host := u.Hostname()
	path := u.Path
	if path == "" || path == "/" {
		return host
	}
	return host + path
}
