// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

package discovery

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ServiceKind identifies the type of a discovered service.
type ServiceKind string

const (
	KindHTTP          ServiceKind = "http"
	KindPostgres      ServiceKind = "postgres"
	KindMySQL         ServiceKind = "mysql"
	KindMongoDB       ServiceKind = "mongodb"
	KindRedis         ServiceKind = "redis"
	KindKafka         ServiceKind = "kafka"
	KindRabbitMQ      ServiceKind = "rabbitmq"
	KindElasticsearch ServiceKind = "elasticsearch"
	KindGenericTCP    ServiceKind = "tcp"
)

// knownPorts maps well-known ports to their service kind and display name.
var knownPorts = map[int]struct {
	Kind ServiceKind
	Name string
}{
	80:    {KindHTTP, "http"},
	443:   {KindHTTP, "https"},
	3000:  {KindHTTP, "http-dev"},
	5000:  {KindHTTP, "http-dev"},
	8000:  {KindHTTP, "http-api"},
	8080:  {KindHTTP, "http-proxy"},
	8443:  {KindHTTP, "https-alt"},
	8888:  {KindHTTP, "http-alt"},
	3306:  {KindMySQL, "mysql"},
	5432:  {KindPostgres, "postgres"},
	5672:  {KindRabbitMQ, "rabbitmq"},
	6379:  {KindRedis, "redis"},
	9092:  {KindKafka, "kafka"},
	9200:  {KindElasticsearch, "elasticsearch-http"},
	9300:  {KindElasticsearch, "elasticsearch-transport"},
	27017: {KindMongoDB, "mongodb"},
}

// Service represents a single discovered service on this host.
type Service struct {
	ID      string      `json:"id"`
	Name    string      `json:"name"`
	Kind    ServiceKind `json:"kind"`
	Host    string      `json:"host"`
	Port    int         `json:"port"`
	PID     int         `json:"pid,omitempty"`
	Binary  string      `json:"binary,omitempty"`
	CmdLine string      `json:"cmdline,omitempty"`
	RawURL  string      `json:"raw_url,omitempty"` // set when service was configured via PROBE_URLS
}

// Snapshot is the full discovery output for one scan cycle.
type Snapshot struct {
	AgentID   string    `json:"agent_id"`
	Hostname  string    `json:"hostname"`
	Timestamp time.Time `json:"timestamp"`
	Services  []Service `json:"services"`
}

// Discoverer runs service discovery against the local host.
type Discoverer struct {
	agentID  string
	hostname string
}

// New creates a Discoverer. agentID is a stable identifier for this agent instance.
func New(agentID string) (*Discoverer, error) {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}
	return &Discoverer{agentID: agentID, hostname: hostname}, nil
}

// Discover performs a full scan and returns a Snapshot.
func (d *Discoverer) Discover(ctx context.Context) (*Snapshot, error) {
	services := d.scanPorts(ctx)
	enrichWithProcessInfo(services)

	return &Snapshot{
		AgentID:   d.agentID,
		Hostname:  d.hostname,
		Timestamp: time.Now().UTC(),
		Services:  services,
	}, nil
}

// ParseProbeURLs builds a Snapshot from a comma-separated list of explicit URLs.
// Used when PROBE_URLS env var is set (e.g. Railway deployment targeting remote services).
func ParseProbeURLs(agentID, hostname, raw string) *Snapshot {
	parts := strings.Split(raw, ",")
	services := make([]Service, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		svc, err := serviceFromURL(p)
		if err != nil {
			continue
		}
		services = append(services, svc)
	}
	return &Snapshot{
		AgentID:   agentID,
		Hostname:  hostname,
		Timestamp: time.Now().UTC(),
		Services:  services,
	}
}

func serviceFromURL(raw string) (Service, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return Service{}, fmt.Errorf("invalid url %q: %w", raw, err)
	}
	host := u.Hostname()
	if host == "" {
		return Service{}, fmt.Errorf("no host in url %q", raw)
	}

	var kind ServiceKind
	var port int

	switch strings.ToLower(u.Scheme) {
	case "https":
		kind, port = KindHTTP, 443
	case "http":
		kind, port = KindHTTP, 80
	case "postgresql", "postgres":
		kind, port = KindPostgres, 5432
	case "redis", "rediss":
		kind, port = KindRedis, 6379
	default:
		kind, port = KindHTTP, 80
	}

	if ps := u.Port(); ps != "" {
		if p, err := strconv.Atoi(ps); err == nil {
			port = p
		}
	}

	label := host
	if u.Path != "" && u.Path != "/" {
		label = host + u.Path
	}

	return Service{
		ID:     fmt.Sprintf("%s-%s-%d", kind, host, port),
		Name:   label,
		Kind:   kind,
		Host:   host,
		Port:   port,
		RawURL: raw,
	}, nil
}

// scanPorts dials every well-known port concurrently with a short timeout.
// Ports that accept a connection are reported as services.
func (d *Discoverer) scanPorts(ctx context.Context) []Service {
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		services []Service
	)

	for port, meta := range knownPorts {
		wg.Add(1)
		go func(p int, kind ServiceKind, name string) {
			defer wg.Done()

			dialCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
			defer cancel()

			conn, err := (&net.Dialer{}).DialContext(dialCtx, "tcp", fmt.Sprintf("127.0.0.1:%d", p))
			if err != nil {
				return
			}
			conn.Close()

			svc := Service{
				ID:   fmt.Sprintf("%s-%d", kind, p),
				Name: name,
				Kind: kind,
				Host: "127.0.0.1",
				Port: p,
			}

			mu.Lock()
			services = append(services, svc)
			mu.Unlock()
		}(port, meta.Kind, meta.Name)
	}

	wg.Wait()
	return services
}
