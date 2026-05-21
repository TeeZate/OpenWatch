// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package fingerprint computes a stable hardware fingerprint for the host.
//
// The fingerprint is a SHA-256 hash of:
//   - /etc/machine-id  (stable Linux machine identifier)
//   - First non-loopback MAC address
//   - Hostname
//
// This fingerprint is bound to the capability token at registration time.
// If the token.json is copied to a different machine, the fingerprints will
// not match and the platform will reject all ingest requests.
package fingerprint

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"strings"
)

// Compute returns the SHA-256 host fingerprint as a hex string.
//
// Priority:
//  1. RAILWAY_SERVICE_ID  — stable across redeploys; changes only if the service
//     is deleted and recreated. Used whenever the probe runs inside Railway.
//  2. /etc/machine-id + first MAC + hostname — used on bare metal / VPS / Docker.
func Compute() (string, error) {
	h := sha256.New()

	// ── Railway: use stable service ID ───────────────────────────────────────
	// RAILWAY_SERVICE_ID is the service UUID on Railway. It survives redeploys
	// because Railway creates a new container for the same service, not a new
	// service. /etc/machine-id is NOT stable — it regenerates per container.
	if railwayID := os.Getenv("RAILWAY_SERVICE_ID"); railwayID != "" {
		h.Write([]byte("railway:"))
		h.Write([]byte(strings.TrimSpace(railwayID)))
		return hex.EncodeToString(h.Sum(nil)), nil
	}

	// ── Bare metal / VPS / Docker: use hardware identifiers ──────────────────
	machineID, err := readMachineID()
	if err != nil {
		// Not fatal — use placeholder; other fields still bind the host
		machineID = "no-machine-id"
	}
	h.Write([]byte(strings.TrimSpace(machineID)))
	h.Write([]byte("|"))

	mac := firstMAC()
	h.Write([]byte(mac))
	h.Write([]byte("|"))

	hostname, _ := os.Hostname()
	h.Write([]byte(hostname))

	return hex.EncodeToString(h.Sum(nil)), nil
}

// Hostname returns the system hostname, used in registration payloads.
func Hostname() string {
	h, _ := os.Hostname()
	return h
}

// ── Internal helpers ──────────────────────────────────────────────────────────

func readMachineID() (string, error) {
	// Linux standard location
	if data, err := os.ReadFile("/etc/machine-id"); err == nil {
		return string(data), nil
	}
	// DBus machine ID (some minimal images)
	if data, err := os.ReadFile("/var/lib/dbus/machine-id"); err == nil {
		return string(data), nil
	}
	// macOS — use IOPlatformUUID via sysctl (fallback for dev)
	return "", fmt.Errorf("no machine-id file found")
}

func firstMAC() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "no-mac"
	}
	for _, iface := range ifaces {
		// Skip loopback and interfaces without a hardware address
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if iface.HardwareAddr == nil || len(iface.HardwareAddr) == 0 {
			continue
		}
		mac := iface.HardwareAddr.String()
		if mac != "" && mac != "00:00:00:00:00:00" {
			return mac
		}
	}
	return "no-mac"
}
