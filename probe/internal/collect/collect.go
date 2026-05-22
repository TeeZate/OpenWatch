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

	// Extended fields — only populated every ExtendedEvery pushes (heavy collectors).
	Database     *DatabaseInfo     `json:"database,omitempty"`
	APISchema    *APISchemaInfo    `json:"api_schema,omitempty"`
	Synthetics   []SyntheticResult `json:"synthetics,omitempty"`
	Architecture *ArchitectureInfo `json:"architecture,omitempty"`
}

// ExtendedEvery controls how often the heavy collectors run.
// At a 30-second push interval this means every 5 minutes.
const ExtendedEvery = 10

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
// When seq == 1 or seq % ExtendedEvery == 0, the heavy extended collectors also run.
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

	// ── Extended collectors (run on seq 1 and every ExtendedEvery pushes) ────
	if seq == 1 || seq%ExtendedEvery == 0 {
		// Database schema — uses DATABASE_URL from auto-discovered services
		dbURL := ""
		for _, svc := range cfg.Services {
			if svc.Kind == "database" || svc.Kind == "postgres" || svc.Kind == "postgresql" {
				dbURL = svc.URL
				break
			}
		}
		if dbURL != "" {
			db := CollectDatabase(dbURL)
			p.Database = &db
		}

		// API schema — fetches /openapi.json from OPENWATCH_SERVICE_URL
		if cfg.ServiceURL != "" {
			schema := CollectAPISchema(cfg.ServiceURL)
			p.APISchema = &schema
		}

		// Synthetic frontend checks — OPENWATCH_FRONTEND_URLS
		if len(cfg.FrontendURLs) > 0 {
			p.Synthetics = CollectSynthetics(cfg.FrontendURLs)
		}

		// Architecture discovery — env-var based integration detection
		arch := CollectArchitecture()
		p.Architecture = &arch
	}

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

	// Memory — prefer cgroup stats inside containers.
	// /proc/meminfo reports the HOST's memory in Docker/Railway environments,
	// making it look like the probe is running on a 270 GB machine.
	// cgroup v2 and v1 expose the actual container limits and usage.
	if usedBytes, totalBytes, ok := cgroupMemory(); ok {
		m.MemUsedMB  = usedBytes / 1024 / 1024
		m.MemTotalMB = totalBytes / 1024 / 1024
		if totalBytes > 0 {
			m.MemUsedPct = round2(float64(usedBytes) / float64(totalBytes) * 100)
		}
	} else if vm, err := mem.VirtualMemory(); err == nil {
		// Fallback for bare metal / macOS dev machines.
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

// ── cgroup memory helpers ─────────────────────────────────────────────────────

// cgroupMemory reads container memory from cgroup v2, then cgroup v1.
// Returns (usedBytes, limitBytes, ok). ok=false means no cgroup info found
// and the caller should fall back to /proc/meminfo via gopsutil.
func cgroupMemory() (uint64, uint64, bool) {
	// ── cgroup v2 (modern kernels: systemd >= 243, Railway, most cloud) ───────
	used, err1 := readCgroupUint64("/sys/fs/cgroup/memory.current")
	limit, err2 := readCgroupUint64("/sys/fs/cgroup/memory.max")
	if err1 == nil && err2 == nil && limit > 0 {
		return used, limit, true
	}

	// ── cgroup v1 (older kernels, some Docker setups) ─────────────────────────
	used, err1 = readCgroupUint64("/sys/fs/cgroup/memory/memory.usage_in_bytes")
	limit, err2 = readCgroupUint64("/sys/fs/cgroup/memory/memory.limit_in_bytes")
	if err1 == nil && err2 == nil && limit > 0 {
		// cgroup v1 uses (1<<63)-4096 as "no limit" sentinel
		const cgroupV1NoLimit = uint64(1<<63 - 4096)
		if limit >= cgroupV1NoLimit {
			return 0, 0, false // no hard limit — fall back to gopsutil
		}
		return used, limit, true
	}

	return 0, 0, false
}

// readCgroupUint64 reads a single uint64 from a cgroup file.
// Returns an error if the file does not exist, is not readable, or contains
// the special string "max" (which cgroup v2 uses for "unlimited").
func readCgroupUint64(path string) (uint64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	s := strings.TrimSpace(string(data))
	if s == "max" || s == "" {
		return 0, fmt.Errorf("no limit")
	}
	var v uint64
	_, err = fmt.Sscan(s, &v)
	return v, err
}

func round2(f float64) float64 {
	return float64(int(f*100)) / 100
}
