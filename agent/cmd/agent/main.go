// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/openwatch/agent/internal/collector"
	"github.com/openwatch/agent/internal/discovery"
	"github.com/openwatch/agent/internal/emitter"
	"github.com/openwatch/agent/internal/probes"
)

// ServiceHealth pairs a discovered service with its latest health probe result.
type ServiceHealth struct {
	discovery.Service
	Health probes.Result `json:"health"`
}

// AgentEvent is the structured payload sent to the backend every tick.
type AgentEvent struct {
	AgentID   string               `json:"agent_id"`
	Hostname  string               `json:"hostname"`
	Timestamp time.Time            `json:"timestamp"`
	Services  []ServiceHealth      `json:"services"`
	Packages  []collector.Package  `json:"packages"`
}

func main() {
	agentID    := agentIDFromEnv()
	interval   := intervalFromEnv()
	backendURL := os.Getenv("BACKEND_URL")
	probeURLs  := os.Getenv("PROBE_URLS") // comma-separated list of remote URLs to probe

	if backendURL == "" {
		log.Println("BACKEND_URL not set — emitting to stdout (dev mode)")
	} else {
		log.Printf("OpenWatch agent starting | id=%s backend=%s interval=%s", agentID, backendURL, interval)
	}
	if probeURLs != "" {
		log.Printf("remote probe mode: %s", probeURLs)
	}

	d, err := discovery.New(agentID)
	if err != nil {
		log.Fatalf("failed to init discoverer: %v", err)
	}

	p := probes.New()
	e := emitter.New(emitter.Config{
		BackendURL: backendURL,
		AgentID:    agentID,
	})

	packages := collector.ScanDirs(collector.DefaultScanRoots())
	log.Printf("collector: found %d packages across all manifests", len(packages))
	tickCount := 0

	for {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		event, err := collect(ctx, d, p, agentID, packages, probeURLs)
		if err != nil {
			log.Printf("collection error: %v", err)
			cancel()
			time.Sleep(interval)
			continue
		}

		if err := e.Send(ctx, event); err != nil {
			log.Printf("emit error: %v", err)
		} else {
			log.Printf("emitted: %d services, %d packages", len(event.Services), len(event.Packages))
		}
		cancel()

		tickCount++
		if tickCount%10 == 0 {
			packages = collector.ScanDirs(collector.DefaultScanRoots())
			log.Printf("collector: refreshed — %d packages", len(packages))
		}

		time.Sleep(interval)
	}
}

func collect(ctx context.Context, d *discovery.Discoverer, p *probes.Prober, agentID string, packages []collector.Package, probeURLs string) (*AgentEvent, error) {
	var snapshot *discovery.Snapshot
	var err error
	if probeURLs != "" {
		hostname, _ := os.Hostname()
		snapshot = discovery.ParseProbeURLs(agentID, hostname, probeURLs)
	} else {
		snapshot, err = d.Discover(ctx)
		if err != nil {
			return nil, fmt.Errorf("discovery: %w", err)
		}
	}

	healthMap := p.ProbeAll(ctx, snapshot.Services)

	services := make([]ServiceHealth, 0, len(snapshot.Services))
	for _, svc := range snapshot.Services {
		sh := ServiceHealth{Service: svc}
		if result, ok := healthMap[svc.ID]; ok {
			sh.Health = result
		}
		services = append(services, sh)
	}

	return &AgentEvent{
		AgentID:   snapshot.AgentID,
		Hostname:  snapshot.Hostname,
		Timestamp: snapshot.Timestamp,
		Services:  services,
		Packages:  packages,
	}, nil
}

func agentIDFromEnv() string {
	if id := os.Getenv("AGENT_ID"); id != "" {
		return id
	}
	hostname, _ := os.Hostname()
	return fmt.Sprintf("agent-%s", hostname)
}

func intervalFromEnv() time.Duration {
	s := os.Getenv("EMIT_INTERVAL")
	if s == "" {
		return 30 * time.Second
	}
	secs, err := strconv.Atoi(s)
	if err != nil {
		return 30 * time.Second
	}
	return time.Duration(secs) * time.Second
}
