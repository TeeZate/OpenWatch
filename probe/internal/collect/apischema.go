// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package collect — OpenAPI / Swagger endpoint discovery.
// Probes the monitored service's well-known OpenAPI paths and parses the
// schema to produce a list of endpoints with method, path, summary and tags.
// Supports OpenAPI 3.x and Swagger 2.x.

package collect

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// candidatePaths is tried in order until one returns a valid JSON schema.
var candidatePaths = []string{
	"/openapi.json",
	"/openapi",
	"/api/openapi.json",
	"/api-docs",
	"/swagger.json",
	"/v1/openapi.json",
	"/v2/openapi.json",
	"/docs/openapi.json",
}

// ── Types ─────────────────────────────────────────────────────────────────────

type APIEndpoint struct {
	Method      string   `json:"method"`
	Path        string   `json:"path"`
	Summary     string   `json:"summary,omitempty"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Deprecated  bool     `json:"deprecated,omitempty"`
}

type APISchemaInfo struct {
	Title       string        `json:"title,omitempty"`
	Version     string        `json:"version,omitempty"`
	Endpoints   []APIEndpoint `json:"endpoints"`
	Source      string        `json:"source,omitempty"` // which URL worked
	Error       string        `json:"error,omitempty"`
	CollectedAt string        `json:"collected_at"`
}

// ── Collector ─────────────────────────────────────────────────────────────────

var apiClient = &http.Client{
	Timeout: 8 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
}

// CollectAPISchema tries all candidate OpenAPI paths on serviceURL and
// returns the parsed endpoint list. Returns APISchemaInfo with Error set
// if none of the paths yields a parseable schema.
func CollectAPISchema(serviceURL string) APISchemaInfo {
	ts := time.Now().UTC().Format(time.RFC3339)
	if serviceURL == "" {
		return APISchemaInfo{CollectedAt: ts}
	}

	base := strings.TrimRight(serviceURL, "/")

	for _, path := range candidatePaths {
		target := base + path
		body, err := fetchJSON(target)
		if err != nil {
			continue
		}

		info, err := parseOpenAPISchema(body)
		if err != nil {
			continue
		}
		info.Source      = target
		info.CollectedAt = ts
		return info
	}

	return APISchemaInfo{
		Error:       fmt.Sprintf("no OpenAPI schema found at any of %v", candidatePaths),
		CollectedAt: ts,
	}
}

// ── Internal ──────────────────────────────────────────────────────────────────

func fetchJSON(url string) ([]byte, error) {
	resp, err := apiClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "json") && !strings.Contains(ct, "yaml") {
		// Might be an HTML 404 page — peek at the body
		peek := make([]byte, 1)
		if _, e := resp.Body.Read(peek); e != nil || peek[0] != '{' {
			return nil, fmt.Errorf("non-JSON content-type: %s", ct)
		}
	}
	return io.ReadAll(resp.Body)
}

// parseOpenAPISchema handles both OpenAPI 3.x and Swagger 2.x JSON payloads.
func parseOpenAPISchema(body []byte) (APISchemaInfo, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return APISchemaInfo{}, fmt.Errorf("not valid JSON: %w", err)
	}

	info := APISchemaInfo{}

	// ── Title + version ───────────────────────────────────────────────────────
	if infoRaw, ok := raw["info"]; ok {
		var infoObj struct {
			Title   string `json:"title"`
			Version string `json:"version"`
		}
		if json.Unmarshal(infoRaw, &infoObj) == nil {
			info.Title   = infoObj.Title
			info.Version = infoObj.Version
		}
	}

	// ── Paths ─────────────────────────────────────────────────────────────────
	pathsRaw, ok := raw["paths"]
	if !ok {
		return info, fmt.Errorf("no 'paths' key — not an OpenAPI schema")
	}

	var paths map[string]map[string]json.RawMessage
	if err := json.Unmarshal(pathsRaw, &paths); err != nil {
		return info, fmt.Errorf("invalid paths: %w", err)
	}

	httpMethods := map[string]bool{
		"get": true, "post": true, "put": true, "patch": true,
		"delete": true, "options": true, "head": true,
	}

	for path, methods := range paths {
		for method, opRaw := range methods {
			if !httpMethods[strings.ToLower(method)] {
				continue
			}
			ep := APIEndpoint{
				Method: strings.ToUpper(method),
				Path:   path,
			}
			var op struct {
				Summary     string   `json:"summary"`
				Description string   `json:"description"`
				Tags        []string `json:"tags"`
				Deprecated  bool     `json:"deprecated"`
			}
			if json.Unmarshal(opRaw, &op) == nil {
				ep.Summary     = op.Summary
				ep.Description = op.Description
				ep.Tags        = op.Tags
				ep.Deprecated  = op.Deprecated
			}
			info.Endpoints = append(info.Endpoints, ep)
		}
	}

	// Sort: by path then method for stable ordering
	sortEndpoints(info.Endpoints)
	return info, nil
}

func sortEndpoints(eps []APIEndpoint) {
	// Simple insertion sort — small list, no imports needed
	for i := 1; i < len(eps); i++ {
		for j := i; j > 0; j-- {
			a, b := eps[j-1], eps[j]
			keyA := a.Path + a.Method
			keyB := b.Path + b.Method
			if keyA > keyB {
				eps[j-1], eps[j] = eps[j], eps[j-1]
			} else {
				break
			}
		}
	}
}
