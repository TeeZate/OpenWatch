// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

//go:build linux

package discovery

import (
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// enrichWithProcessInfo correlates each discovered service port with the
// Linux process that owns its socket by reading /proc/net/tcp and /proc/<pid>/fd.
func enrichWithProcessInfo(services []Service) {
	portToPID := buildPortPIDMap()
	for i := range services {
		pid, ok := portToPID[services[i].Port]
		if !ok {
			continue
		}
		services[i].PID = pid
		services[i].Binary = readComm(pid)
		services[i].CmdLine = readCmdLine(pid)
	}
}

// buildPortPIDMap reads /proc/net/tcp to find which inode owns each local port,
// then walks /proc/<pid>/fd to map inodes back to PIDs.
func buildPortPIDMap() map[int]int {
	inodeToPort := parseNetTCP("/proc/net/tcp")
	result := make(map[int]int)

	entries, err := os.ReadDir("/proc")
	if err != nil {
		return result
	}

	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue // not a PID directory
		}
		fdDir := fmt.Sprintf("/proc/%d/fd", pid)
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			// socket:[inode]
			if !strings.HasPrefix(link, "socket:[") {
				continue
			}
			inodeStr := strings.TrimSuffix(strings.TrimPrefix(link, "socket:["), "]")
			inode, err := strconv.ParseUint(inodeStr, 10, 64)
			if err != nil {
				continue
			}
			if port, ok := inodeToPort[inode]; ok {
				result[port] = pid
			}
		}
	}
	return result
}

// parseNetTCP reads /proc/net/tcp and returns a map of socket inode → local port.
// Only LISTEN state (0A) sockets are included.
func parseNetTCP(path string) map[uint64]int {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	result := make(map[uint64]int)
	lines := strings.Split(string(data), "\n")
	for _, line := range lines[1:] { // skip header
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		state := fields[3]
		if state != "0A" { // 0A = TCP_LISTEN
			continue
		}
		localAddr := fields[1]
		inodeStr := fields[9]
		port, err := parseHexPort(localAddr)
		if err != nil {
			continue
		}
		inode, err := strconv.ParseUint(inodeStr, 10, 64)
		if err != nil {
			continue
		}
		result[inode] = port
	}
	return result
}

// parseHexPort extracts the port from a /proc/net/tcp local_address field (hex IP:port).
func parseHexPort(addr string) (int, error) {
	parts := strings.Split(addr, ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid addr %s", addr)
	}
	portBytes, err := hex.DecodeString(parts[1])
	if err != nil {
		return 0, err
	}
	return int(portBytes[0])<<8 | int(portBytes[1]), nil
}

func readComm(pid int) string {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func readCmdLine(pid int) string {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return ""
	}
	// cmdline is NUL-separated; show just the first 120 chars
	cmd := strings.ReplaceAll(string(data), "\x00", " ")
	cmd = strings.TrimSpace(cmd)
	if len(cmd) > 120 {
		cmd = cmd[:120] + "..."
	}
	return cmd
}
