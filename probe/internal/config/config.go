// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package config loads probe configuration from a JSON file or environment variables.
//
// Priority order:
//  1. Environment variables (OPENWATCH_TOKEN_JSON, OPENWATCH_CLIENT_CERT_PEM, OPENWATCH_CLIENT_KEY_PEM)
//  2. JSON config file at the provided path
//  3. Default path: /etc/openwatch/config.json
//
// The JSON config file written by the installer looks like:
//
//	{
//	  "token": { ...token fields from platform... },
//	  "cert_pem": "-----BEGIN CERTIFICATE-----...",
//	  "key_pem":  "-----BEGIN RSA PRIVATE KEY-----...",
//	  "services": [
//	    {"name": "postgres", "kind": "database", "url": "postgres://..."},
//	    {"name": "redis",    "kind": "redis",    "url": "redis://..."}
//	  ],
//	  "intervals": {"push_seconds": 30, "os_seconds": 15, "services_seconds": 30}
//	}
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// TokenConfig holds the capability token downloaded from the OpenWatch platform.
type TokenConfig struct {
	TokenID           string   `json:"token_id"`
	SystemID          string   `json:"system_id"`
	Scopes            []string `json:"scopes"`
	IssuedAt          int64    `json:"issued_at"`
	ExpiresAt         int64    `json:"expires_at"`
	HMACKey           string   `json:"hmac_key"`
	PlatformURL       string   `json:"platform_url"`
	PlatformPublicKey string   `json:"platform_public_key"`
	Signature         string   `json:"signature"`
}

// ServiceConfig describes one dependency to check on each probe cycle.
type ServiceConfig struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // database | redis | http | tcp
	URL  string `json:"url"`
}

// Intervals controls how often each collector runs (seconds).
type Intervals struct {
	PushSeconds     int `json:"push_seconds"`     // how often to push a payload (default 30)
	OSSeconds       int `json:"os_seconds"`       // how often to collect OS metrics (default 15)
	ServicesSeconds int `json:"services_seconds"` // how often to check services (default 30)
	NetworkSeconds  int `json:"network_seconds"`  // how often to scan network (default 60)
}

// Config is the complete runtime configuration for the probe.
type Config struct {
	Token        TokenConfig     `json:"token"`
	CertPEM      string          `json:"cert_pem"`
	KeyPEM       string          `json:"key_pem"`
	Services     []ServiceConfig `json:"services"`
	Intervals    Intervals       `json:"intervals"`

	// Extended monitoring (optional)
	ServiceURL   string   `json:"service_url"`    // base URL of the monitored API (for OpenAPI fetch)
	FrontendURLs []string `json:"frontend_urls"`  // comma-separated frontend URLs for synthetic checks
}

// Load reads configuration from environment variables first, then falls back to
// the JSON file at path. Returns an error if neither source yields a valid config.
func Load(path string) (*Config, error) {
	cfg := &Config{}

	// ── Try environment variables first (Railway / Docker deployment) ──────────
	tokenJSON := os.Getenv("OPENWATCH_TOKEN_JSON")
	certPEM   := os.Getenv("OPENWATCH_CLIENT_CERT_PEM")
	keyPEM    := os.Getenv("OPENWATCH_CLIENT_KEY_PEM")

	if tokenJSON != "" {
		if err := json.Unmarshal([]byte(tokenJSON), &cfg.Token); err != nil {
			return nil, fmt.Errorf("invalid OPENWATCH_TOKEN_JSON: %w", err)
		}
		// Railway stores env vars with literal \n instead of real newlines.
		// PEM format requires real newlines — fix them here.
		cfg.CertPEM = normalizePEM(certPEM)
		cfg.KeyPEM  = normalizePEM(keyPEM)
	} else {
		// ── Fall back to config file ──────────────────────────────────────────
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf(
				"config file not found at %q and OPENWATCH_TOKEN_JSON env var not set: %w",
				path, err,
			)
		}
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("invalid config file at %q: %w", path, err)
		}
	}

	// ── Auto-discover services from well-known env vars ───────────────────────
	cfg.Services = append(cfg.Services, autoDiscoverServices()...)

	// ── Extended monitoring env vars ──────────────────────────────────────────
	if v := os.Getenv("OPENWATCH_SERVICE_URL"); v != "" {
		cfg.ServiceURL = strings.TrimRight(v, "/")
	}
	if v := os.Getenv("OPENWATCH_FRONTEND_URLS"); v != "" {
		for _, u := range strings.Split(v, ",") {
			u = strings.TrimSpace(u)
			if u != "" {
				cfg.FrontendURLs = append(cfg.FrontendURLs, u)
			}
		}
	}

	// ── Expand ${ENV_VAR} references in service URLs ──────────────────────────
	for i := range cfg.Services {
		cfg.Services[i].URL = os.ExpandEnv(cfg.Services[i].URL)
	}

	// ── Apply defaults for intervals ──────────────────────────────────────────
	if cfg.Intervals.PushSeconds     == 0 { cfg.Intervals.PushSeconds     = 30 }
	if cfg.Intervals.OSSeconds       == 0 { cfg.Intervals.OSSeconds       = 15 }
	if cfg.Intervals.ServicesSeconds == 0 { cfg.Intervals.ServicesSeconds = 30 }
	if cfg.Intervals.NetworkSeconds  == 0 { cfg.Intervals.NetworkSeconds  = 60 }

	// ── Validate required fields ──────────────────────────────────────────────
	if cfg.Token.TokenID == "" {
		return nil, fmt.Errorf("token.token_id is required")
	}
	if cfg.Token.SystemID == "" {
		return nil, fmt.Errorf("token.system_id is required")
	}
	if cfg.Token.PlatformURL == "" {
		return nil, fmt.Errorf("token.platform_url is required")
	}
	if !strings.HasPrefix(cfg.Token.PlatformURL, "http") {
		return nil, fmt.Errorf("token.platform_url must start with http:// or https://")
	}

	return cfg, nil
}

// normalizePEM converts Railway-style literal \n sequences to real newlines
// and trims surrounding whitespace. Railway stores multi-line env vars with
// the two-character sequence backslash-n instead of a real newline byte,
// which breaks PEM parsing and tls.X509KeyPair.
func normalizePEM(pem string) string {
	if pem == "" {
		return ""
	}
	pem = strings.ReplaceAll(pem, `\n`, "\n")
	return strings.TrimSpace(pem)
}

// autoDiscoverServices checks for well-known environment variables and adds
// service checks for any it finds. This means a Railway deployment only needs
// OPENWATCH_TOKEN_JSON — existing DATABASE_URL and REDIS_URL are auto-detected.
func autoDiscoverServices() []ServiceConfig {
	var svcs []ServiceConfig

	if url := os.Getenv("DATABASE_URL"); url != "" {
		svcs = append(svcs, ServiceConfig{Name: "postgres", Kind: "database", URL: url})
	}
	if url := os.Getenv("REDIS_URL"); url != "" {
		svcs = append(svcs, ServiceConfig{Name: "redis", Kind: "redis", URL: url})
	}
	if url := os.Getenv("REDIS_PRIVATE_URL"); url != "" && os.Getenv("REDIS_URL") == "" {
		svcs = append(svcs, ServiceConfig{Name: "redis", Kind: "redis", URL: url})
	}
	if url := os.Getenv("MONGODB_URL"); url != "" {
		svcs = append(svcs, ServiceConfig{Name: "mongodb", Kind: "mongodb", URL: url})
	}

	return svcs
}
