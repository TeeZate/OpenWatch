// Business Source License 1.1
// Copyright (c) 2026 OpenWatch
// Change Date: Four years from the release date of this file
// Change License: Apache License, Version 2.0

// Package collector scans the host for package manifests and extracts
// dependency names and versions. Supports requirements.txt, package.json,
// and go.mod. Results are included in every AgentEvent so the backend
// intelligence layer can check for outdated packages and CVEs.
package collector

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Ecosystem identifies the package registry a dependency belongs to.
type Ecosystem string

const (
	EcosystemPyPI  Ecosystem = "PyPI"
	EcosystemNPM   Ecosystem = "npm"
	EcosystemGo    Ecosystem = "Go"
	EcosystemMaven Ecosystem = "Maven"
)

// Package represents a single dependency found in a manifest.
type Package struct {
	Name      string    `json:"name"`
	Version   string    `json:"version"`
	Ecosystem Ecosystem `json:"ecosystem"`
	Source    string    `json:"source"` // relative path of manifest file
}

// ScanDirs walks a set of root directories looking for known manifests.
// Returns deduplicated packages across all found manifests.
func ScanDirs(roots []string) []Package {
	seen := make(map[string]bool)
	var all []Package

	for _, root := range roots {
		pkgs := scanDir(root)
		for _, p := range pkgs {
			key := string(p.Ecosystem) + ":" + p.Name
			if !seen[key] {
				seen[key] = true
				all = append(all, p)
			}
		}
	}
	return all
}

// DefaultScanRoots returns commonly used application roots on Linux.
// On non-Linux systems it returns only the current working directory.
func DefaultScanRoots() []string {
	return defaultScanRoots()
}

// scanDir looks for manifests up to 3 levels deep inside root.
func scanDir(root string) []Package {
	var pkgs []Package

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return filepath.SkipDir
		}
		// Skip hidden and vendor directories
		name := d.Name()
		if strings.HasPrefix(name, ".") || name == "vendor" || name == "node_modules" {
			return filepath.SkipDir
		}
		// Limit depth
		rel, _ := filepath.Rel(root, path)
		if strings.Count(rel, string(os.PathSeparator)) > 3 {
			return filepath.SkipDir
		}

		if d.IsDir() {
			return nil
		}

		switch name {
		case "requirements.txt":
			pkgs = append(pkgs, parseRequirementsTxt(path)...)
		case "package.json":
			pkgs = append(pkgs, parsePackageJSON(path)...)
		case "go.mod":
			pkgs = append(pkgs, parseGoMod(path)...)
		}
		return nil
	})

	return pkgs
}

// ── requirements.txt ──────────────────────────────────────────────────────────

var reqLineRe = regexp.MustCompile(`^([A-Za-z0-9_.\-]+)[=><!\^~]+([A-Za-z0-9_.\-\*]+)`)

func parseRequirementsTxt(path string) []Package {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var pkgs []Package
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "-") {
			continue
		}
		m := reqLineRe.FindStringSubmatch(line)
		if len(m) < 3 {
			continue
		}
		pkgs = append(pkgs, Package{
			Name:      strings.ToLower(m[1]),
			Version:   m[2],
			Ecosystem: EcosystemPyPI,
			Source:    path,
		})
	}
	return pkgs
}

// ── package.json ──────────────────────────────────────────────────────────────

func parsePackageJSON(path string) []Package {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	var manifest struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil
	}

	var pkgs []Package
	for name, ver := range manifest.Dependencies {
		pkgs = append(pkgs, Package{
			Name:      name,
			Version:   strings.TrimLeft(ver, "^~>=<"),
			Ecosystem: EcosystemNPM,
			Source:    path,
		})
	}
	// Include devDependencies — outdated dev tools can still introduce CVEs
	for name, ver := range manifest.DevDependencies {
		pkgs = append(pkgs, Package{
			Name:      name,
			Version:   strings.TrimLeft(ver, "^~>=<"),
			Ecosystem: EcosystemNPM,
			Source:    path,
		})
	}
	return pkgs
}

// ── go.mod ────────────────────────────────────────────────────────────────────

var goRequireRe = regexp.MustCompile(`^\s+([^\s]+)\s+v([^\s]+)`)

func parseGoMod(path string) []Package {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	var pkgs []Package
	inRequire := false
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "require (" {
			inRequire = true
			continue
		}
		if inRequire && trimmed == ")" {
			inRequire = false
			continue
		}
		if inRequire {
			m := goRequireRe.FindStringSubmatch(line)
			if len(m) >= 3 {
				pkgs = append(pkgs, Package{
					Name:      m[1],
					Version:   m[2],
					Ecosystem: EcosystemGo,
					Source:    path,
				})
			}
		}
	}
	return pkgs
}
