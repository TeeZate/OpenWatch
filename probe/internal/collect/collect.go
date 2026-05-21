// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package collect gathers OS, service, network, and process telemetry.
// All collectors run synchronously within a single Build() call on each
// probe cycle. The probe interval controls how often Build is called.
package collect

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	gnet "github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"

	"openwatch/probe/internal/config"
)

// ── Payload types (match the platform's expected JSON schema) ─────────────────

// Payload is the complete ingest payload sent to /api/v1/ingest/{system_id}.
type Payload struct {
	ProbeID         string          `json:"probe_id"`
	SystemID        string          `json:"system_id"`
	TokenID         string          `json:"token_id"`
	HostFingerprint string          `json:"host_fingerprint"`
	Sequence        int64           `json:"sequence"`
	Timestamp       int64           `json:"timestamp"`
	OS              OSMetrics       `json:"os"`
	Services        []ServiceResult `json:"services"`
	Network         NetworkMetrics  `json:"network"`
	Processes       []ProcessInfo   `json:"processes"`
	Topology        TopologyInfo    `json:"topology"`
}

type OSMetrics struct {
	CPUPct      float64 `json:"cpu_pct"`
	MemUsedMB   uint64  `json:"mem_used_mb"`
	MemTotalMB  uint64  `json:"mem_total_mb"`
	MemUsedPct  float64 `json:"mem_used_pct"`
	DiskUsedPct float64 `json:"disk_used_pct"`
	DiskUsedGB  float64 `json:"disk_used_gb"`
	DiskTotalGB float64 `json:"disk_total_gb"`
	Load1m      float64 `json:"load_1m"`
	Load5m      float64 `json:"load_5m"`
	Load15m     float64 `json:"load_15m"`
	UptimeS     uint64  `json:"uptime_s"`
	GOOS        string  `json:"os"`
}

type ServiceResult struct {
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	Status    string  `json:"status"`
	LatencyMS float64 `json:"latency_ms,omitempty"`
	Message   string  `json:"message,omitempty"`
}

type NetworkMetrics struct {
	OpenPorts   []uint32 `json:"open_ports"`
	Connections int      `json:"connections"`
	BytesInPS   float64  `json:"bytes_in_ps"`
	BytesOutPS  float64  `json:"bytes_out_ps"`
}

type ProcessInfo struct {
	PID     int32   `json:"pid"`
	Name    string  `json:"name"`
	CPUPct  float64 `json:"cpu_pct"`
	MemMB   float64 `json:"mem_mb"`
	Status  string  `json:"status"`
}

type TopologyInfo struct {
	Hostname string `json:"hostname"`
	GOOS     string `json:"os"`
	GoArch   string `json:"arch"`
}

// ── Build assembles a complete telemetry payload ──────────────────────────────

// Build collects all telemetry and returns a payload ready for signing + pushing.
// probeID is a stable identifier for this probe installation (generated on first run).
func Build(cfg *config.Config, fp string, seq int64, version string) (*Payload, error) {
	host, _ := os.Hostname()
	if host == "" {
		host = "unknown"
	}

	p := &Payload{
		ProbeID:         cfg.Token.TokenID + "-probe",
		SystemID:        cfg.Token.SystemID,
		TokenID:         cfg.Token.TokenID,
		HostFingerprint: fp,
		Sequence:        seq,
		Timestamp:       time.Now().Unix(),
		Topology: TopologyInfo{
			Hostname: host,
			GOOS:     runtime.GOOS,
			GoArch:   runtime.GOARCH,
		},
	}

	p.OS        = collectOS()
	p.Services  = collectServices(cfg.Services)
	p.Network   = collectNetwork()
	p.Processes = collectProcesses()

	return p, nil
}

// ── OS metrics ────────────────────────────────────────────────────────────────

func collectOS() OSMetrics {
	m := OSMetrics{GOOS: runtime.GOOS}

	// CPU — sample over 500ms for accuracy
	cpuPcts, err := cpu.Percent(500*time.Millisecond, false)
	if err == nil && len(cpuPcts) > 0 {
		m.CPUPct = round2(cpuPcts[0])
	}

	// Memory
	if vm, err := mem.VirtualMemory(); err == nil {
		m.MemUsedMB  = vm.Used / 1024 / 1024
		m.MemTotalMB = vm.Total / 1024 / 1024
		m.MemUsedPct = round2(vm.UsedPercent)
	}

	// Disk (root partition)
	if du, err := disk.Usage("/"); err == nil {
		m.DiskUsedPct = round2(du.UsedPercent)
		m.DiskUsedGB  = round2(float64(du.Used)  / 1e9)
		m.DiskTotalGB = round2(float64(du.Total) / 1e9)
	}

	// Load average
	if la, err := load.Avg(); err == nil {
		m.Load1m  = round2(la.Load1)
		m.Load5m  = round2(la.Load5)
		m.Load15m = round2(la.Load15)
	}

	return m
}

// ── Service checks ────────────────────────────────────────────────────────────

func collectServices(services []config.ServiceConfig) []ServiceResult {
	results := make([]ServiceResult, 0, len(services))
	for _, svc := range services {
		if svc.URL == "" {
			continue
		}
		results = append(results, checkService(svc))
	}
	return results
}

func checkService(svc config.ServiceConfig) ServiceResult {
	switch svc.Kind {
	case "redis":
		return checkRedis(svc)
	case "database", "postgres", "postgresql":
		return checkTCP(svc, 5432)
	case "mongodb":
		return checkTCP(svc, 27017)
	case "http", "https":
		return checkHTTP(svc)
	default:
		return checkTCP(svc, 0)
	}
}

// checkRedis dials Redis and sends a PING command, measuring round-trip latency.
func checkRedis(svc config.ServiceConfig) ServiceResult {
	addr, err := redisAddr(svc.URL)
	if err != nil {
		return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "down", Message: err.Error()}
	}

	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "down",
			Message: fmt.Sprintf("connection refused: %v", err)}
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(3 * time.Second))
	fmt.Fprintf(conn, "*1\r\n$4\r\nPING\r\n")

	scanner := bufio.NewScanner(conn)
	if scanner.Scan() {
		latency := float64(time.Since(start).Microseconds()) / 1000.0
		line := scanner.Text()
		if strings.HasPrefix(line, "+PONG") || strings.HasPrefix(line, "$") {
			return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "up",
				LatencyMS: round2(latency)}
		}
		return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "degraded",
			Message: "unexpected response: " + line, LatencyMS: round2(latency)}
	}

	return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "down", Message: "no response"}
}

// checkTCP measures TCP connection latency to a host:port.
func checkTCP(svc config.ServiceConfig, defaultPort int) ServiceResult {
	addr, err := tcpAddr(svc.URL, defaultPort)
	if err != nil {
		return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "down", Message: err.Error()}
	}

	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	latency := float64(time.Since(start).Microseconds()) / 1000.0
	if err != nil {
		return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "down",
			Message: err.Error()}
	}
	conn.Close()

	return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "up",
		LatencyMS: round2(latency)}
}

// checkHTTP makes a GET request to the service URL and checks for a 2xx/3xx response.
func checkHTTP(svc config.ServiceConfig) ServiceResult {
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	target := svc.URL
	if !strings.Contains(target, "/health") {
		target = strings.TrimRight(target, "/") + "/health"
	}

	start := time.Now()
	resp, err := client.Get(target)
	latency := float64(time.Since(start).Microseconds()) / 1000.0

	if err != nil {
		return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: "down",
			Message: err.Error()}
	}
	defer resp.Body.Close()

	status := "up"
	if resp.StatusCode >= 500 {
		status = "down"
	} else if resp.StatusCode >= 400 {
		status = "degraded"
	}

	return ServiceResult{Name: svc.Name, Kind: svc.Kind, Status: status,
		LatencyMS: round2(latency),
		Message:   fmt.Sprintf("HTTP %d", resp.StatusCode)}
}

// ── Network metrics ───────────────────────────────────────────────────────────

func collectNetwork() NetworkMetrics {
	nm := NetworkMetrics{}

	// Listening ports
	conns, err := gnet.Connections("inet")
	if err == nil {
		seen := make(map[uint32]bool)
		activeCount := 0
		for _, c := range conns {
			if c.Status == "LISTEN" && !seen[c.Laddr.Port] {
				seen[c.Laddr.Port] = true
				nm.OpenPorts = append(nm.OpenPorts, c.Laddr.Port)
			}
			if c.Status == "ESTABLISHED" {
				activeCount++
			}
		}
		nm.Connections = activeCount
	}

	// Bandwidth (sample two reads 500ms apart)
	io1, err := gnet.IOCounters(false)
	if err == nil {
		time.Sleep(500 * time.Millisecond)
		io2, err2 := gnet.IOCounters(false)
		if err2 == nil && len(io1) > 0 && len(io2) > 0 {
			nm.BytesInPS  = round2(float64(io2[0].BytesRecv-io1[0].BytesRecv) * 2)
			nm.BytesOutPS = round2(float64(io2[0].BytesSent-io1[0].BytesSent) * 2)
		}
	}

	return nm
}

// ── Process list ──────────────────────────────────────────────────────────────

const maxProcs = 10

func collectProcesses() []ProcessInfo {
	procs, err := process.Processes()
	if err != nil {
		return nil
	}

	results := make([]ProcessInfo, 0, maxProcs)
	for _, p := range procs {
		name, err := p.Name()
		if err != nil || name == "" {
			continue
		}

		cpuPct, _ := p.CPUPercent()
		mi, _ := p.MemoryInfo()
		memMB := 0.0
		if mi != nil {
			memMB = round2(float64(mi.RSS) / 1024 / 1024)
		}
		statuses, _ := p.Status()
		status := "running"
		if len(statuses) > 0 {
			status = statuses[0]
		}

		results = append(results, ProcessInfo{
			PID:    p.Pid,
			Name:   name,
			CPUPct: round2(cpuPct),
			MemMB:  memMB,
			Status: status,
		})

		if len(results) >= maxProcs {
			break
		}
	}
	return results
}

// ── URL parsing helpers ───────────────────────────────────────────────────────

func redisAddr(rawURL string) (string, error) {
	if !strings.Contains(rawURL, "://") {
		rawURL = "redis://" + rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	host := u.Hostname()
	port := u.Port()
	if port == "" {
		port = "6379"
	}
	return net.JoinHostPort(host, port), nil
}

func tcpAddr(rawURL string, defaultPort int) (string, error) {
	// Handle postgres:// or plain host:port
	if strings.Contains(rawURL, "://") {
		u, err := url.Parse(rawURL)
		if err != nil {
			return "", err
		}
		host := u.Hostname()
		port := u.Port()
		if port == "" {
			port = fmt.Sprintf("%d", defaultPort)
		}
		return net.JoinHostPort(host, port), nil
	}
	// Already host:port
	if strings.Contains(rawURL, ":") {
		return rawURL, nil
	}
	return fmt.Sprintf("%s:%d", rawURL, defaultPort), nil
}

func round2(f float64) float64 {
	return float64(int(f*100)) / 100
}
