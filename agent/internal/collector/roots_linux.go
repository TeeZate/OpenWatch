// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

//go:build linux

package collector

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func defaultScanRoots() []string {
	// Standard application roots
	roots := []string{"/app", "/srv", "/opt", "/var/www"}

	// Add cwd of every running process — catches apps in non-standard locations
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return roots
	}

	seen := make(map[string]bool)
	for _, e := range entries {
		if _, err := strconv.Atoi(e.Name()); err != nil {
			continue
		}
		cwd, err := os.Readlink(fmt.Sprintf("/proc/%s/cwd", e.Name()))
		if err != nil {
			continue
		}
		// Skip kernel / system roots to avoid scanning the entire filesystem
		if cwd == "/" || strings.HasPrefix(cwd, "/proc") || strings.HasPrefix(cwd, "/sys") {
			continue
		}
		// Only keep the top-level process root (e.g. /home/deploy/myapp not /home/deploy/myapp/src)
		parts := strings.SplitN(strings.TrimPrefix(cwd, "/"), "/", 4)
		if len(parts) >= 3 {
			cwd = "/" + filepath.Join(parts[:3]...)
		}
		if !seen[cwd] {
			seen[cwd] = true
			roots = append(roots, cwd)
		}
	}
	return roots
}
