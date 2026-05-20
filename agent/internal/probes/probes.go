// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

package probes

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/openwatch/agent/internal/discovery"
)

// Status is the health status of a probed service.
type Status string

const (
	StatusUp       Status = "up"
	StatusDegraded Status = "degraded"
	StatusDown     Status = "down"
)

// Result holds the outcome of a single health probe.
type Result struct {
	ServiceID string    `json:"service_id"`
	Status    Status    `json:"status"`
	LatencyMs float64   `json:"latency_ms"`
	Message   string    `json:"message,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}

// Prober runs health checks against discovered services.
type Prober struct {
	httpClient *http.Client
}

// New creates a Prober with a shared HTTP client (no redirects, short timeout).
func New() *Prober {
	return &Prober{
		httpClient: &http.Client{
			Timeout: 3 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// ProbeAll runs health checks for every service concurrently and returns results
// keyed by service ID.
func (p *Prober) ProbeAll(ctx context.Context, services []discovery.Service) map[string]Result {
	var (
		mu      sync.Mutex
		wg      sync.WaitGroup
		results = make(map[string]Result, len(services))
	)

	for _, svc := range services {
		wg.Add(1)
		go func(s discovery.Service) {
			defer wg.Done()
			r := p.probe(ctx, s)
			mu.Lock()
			results[s.ID] = r
			mu.Unlock()
		}(svc)
	}

	wg.Wait()
	return results
}

// probe dispatches to the right probe function based on service kind.
func (p *Prober) probe(ctx context.Context, svc discovery.Service) Result {
	switch svc.Kind {
	case discovery.KindHTTP:
		return p.probeHTTP(ctx, svc)
	case discovery.KindRedis:
		return probeRedis(ctx, svc)
	case discovery.KindPostgres, discovery.KindMySQL, discovery.KindMongoDB:
		return probeTCP(ctx, svc)
	default:
		return probeTCP(ctx, svc)
	}
}

// probeHTTP sends GET /health then falls back to GET /.
// When svc.RawURL is set (PROBE_URLS mode), it is used as the base URL directly
// so that Railway/external HTTPS URLs are probed without an explicit port suffix.
func (p *Prober) probeHTTP(ctx context.Context, svc discovery.Service) Result {
	var baseURL string
	if svc.RawURL != "" {
		baseURL = strings.TrimRight(svc.RawURL, "/")
	} else {
		scheme := "http"
		if svc.Port == 443 || svc.Port == 8443 {
			scheme = "https"
		}
		baseURL = fmt.Sprintf("%s://%s:%d", scheme, svc.Host, svc.Port)
	}

	for _, path := range []string{"/health", "/healthz", "/"} {
		url := baseURL + path

		start := time.Now()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", "openwatch-agent/0.1")

		resp, err := p.httpClient.Do(req)
		latency := ms(time.Since(start))

		if err != nil {
			return Result{
				ServiceID: svc.ID,
				Status:    StatusDown,
				LatencyMs: latency,
				Message:   err.Error(),
				CheckedAt: time.Now().UTC(),
			}
		}
		resp.Body.Close()

		status := StatusUp
		msg := fmt.Sprintf("%s %d", path, resp.StatusCode)
		if resp.StatusCode >= 500 {
			status = StatusDegraded
		}

		return Result{
			ServiceID: svc.ID,
			Status:    status,
			LatencyMs: latency,
			Message:   msg,
			CheckedAt: time.Now().UTC(),
		}
	}

	return Result{ServiceID: svc.ID, Status: StatusDown, CheckedAt: time.Now().UTC()}
}

// probeRedis sends a raw RESP PING and expects +PONG.
// Uses no external dependency — Redis protocol is trivially simple.
func probeRedis(ctx context.Context, svc discovery.Service) Result {
	addr := fmt.Sprintf("%s:%d", svc.Host, svc.Port)

	start := time.Now()
	d := net.Dialer{}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return Result{
			ServiceID: svc.ID,
			Status:    StatusDown,
			LatencyMs: ms(time.Since(start)),
			Message:   err.Error(),
			CheckedAt: time.Now().UTC(),
		}
	}
	defer conn.Close()

	// RESP inline PING
	conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := fmt.Fprintf(conn, "*1\r\n$4\r\nPING\r\n"); err != nil {
		return Result{ServiceID: svc.ID, Status: StatusDown, LatencyMs: ms(time.Since(start)), Message: err.Error(), CheckedAt: time.Now().UTC()}
	}

	scanner := bufio.NewScanner(conn)
	scanner.Scan()
	latency := ms(time.Since(start))
	line := scanner.Text()

	status := StatusDown
	msg := line
	if line == "+PONG" {
		status = StatusUp
		msg = "PONG"
	}

	return Result{
		ServiceID: svc.ID,
		Status:    status,
		LatencyMs: latency,
		Message:   msg,
		CheckedAt: time.Now().UTC(),
	}
}

// probeTCP measures TCP connection latency. Used for Postgres, MySQL, MongoDB.
// A successful dial means the service is accepting connections.
func probeTCP(ctx context.Context, svc discovery.Service) Result {
	addr := fmt.Sprintf("%s:%d", svc.Host, svc.Port)
	start := time.Now()
	d := net.Dialer{}
	conn, err := d.DialContext(ctx, "tcp", addr)
	latency := ms(time.Since(start))

	if err != nil {
		return Result{
			ServiceID: svc.ID,
			Status:    StatusDown,
			LatencyMs: latency,
			Message:   err.Error(),
			CheckedAt: time.Now().UTC(),
		}
	}
	conn.Close()

	return Result{
		ServiceID: svc.ID,
		Status:    StatusUp,
		LatencyMs: latency,
		Message:   "tcp connection ok",
		CheckedAt: time.Now().UTC(),
	}
}

func ms(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000.0
}
