// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

//go:build !linux

package collector

import "os"

func defaultScanRoots() []string {
	if cwd, err := os.Getwd(); err == nil {
		return []string{cwd}
	}
	return []string{"."}
}
