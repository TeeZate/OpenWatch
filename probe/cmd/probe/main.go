// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// openwatch-probe — Authorized system monitoring agent
//
// Usage:
//
//	openwatch-probe start    [--config PATH]   Start pushing telemetry
//	openwatch-probe status                     Show probe + last push info
//	openwatch-probe validate [--config PATH]   Validate token signature
//	openwatch-probe version                    Print version
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"openwatch/probe/internal/collect"
	"openwatch/probe/internal/config"
	"openwatch/probe/internal/fingerprint"
	"openwatch/probe/internal/push"
	"openwatch/probe/internal/register"
	"openwatch/probe/internal/sign"
)

const version = "1.0.0"

func main() {
	log.SetFlags(log.LstdFlags)
	log.SetPrefix("[openwatch-probe] ")

	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "start":
		cmdStart(os.Args[2:])
	case "status":
		cmdStatus()
	case "validate":
		cmdValidate(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Printf("openwatch-probe %s\n", version)
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Print(`OpenWatch Probe — Authorized system monitoring agent

Usage:
    openwatch-probe start    [--config PATH]   Start pushing telemetry
    openwatch-probe status                     Show probe status
    openwatch-probe validate [--config PATH]   Validate token signature
    openwatch-probe version                    Print version

Environment variables (alternative to --config, for Railway/Docker):
    OPENWATCH_TOKEN_JSON        Full JSON content of the token object
    OPENWATCH_CLIENT_CERT_PEM   PEM content of the client certificate
    OPENWATCH_CLIENT_KEY_PEM    PEM content of the client private key
    DATABASE_URL                Auto-discovered PostgreSQL service check
    REDIS_URL                   Auto-discovered Redis service check

`)
}

// ── start ─────────────────────────────────────────────────────────────────────

func cmdStart(args []string) {
	fs := flag.NewFlagSet("start", flag.ExitOnError)
	configPath := fs.String("config", "/etc/openwatch/config.json", "Path to config file")
	fs.Parse(args)

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Config error: %v\n\nSet OPENWATCH_TOKEN_JSON env var or provide --config path.", err)
	}

	log.Printf("OpenWatch Probe %s starting", version)
	log.Printf("Platform : %s", cfg.Token.PlatformURL)
	log.Printf("System   : %s", cfg.Token.SystemID)
	log.Printf("Token    : %s", cfg.Token.TokenID)
	log.Printf("Scopes   : %v", cfg.Token.Scopes)
	log.Printf("Services : %d configured", len(cfg.Services))
	for _, svc := range cfg.Services {
		log.Printf("  %-12s (%s)", svc.Name, svc.Kind)
	}

	// Compute host fingerprint
	fp, err := fingerprint.Compute()
	if err != nil {
		log.Fatalf("Host fingerprint error: %v", err)
	}
	log.Printf("Fingerprint: %s…", fp[:16])

	// Register with platform (idempotent — safe to call every startup)
	log.Println("Registering with platform…")
	if err := register.EnsureRegistered(cfg, fp, version); err != nil {
		log.Printf("Registration failed: %v", err)
		// Sleep before exit so Railway's restart policy doesn't spin into a
		// tight crash loop. A 60-second delay gives the operator time to see
		// the log and take action (revoke token, fix env vars, etc.).
		log.Println("Waiting 60 s before exit to prevent restart storm…")
		time.Sleep(60 * time.Second)
		os.Exit(1)
	}

	// Build mTLS push client
	client, err := push.NewClient(cfg)
	if err != nil {
		log.Fatalf("Push client error: %v", err)
	}

	// Run the probe loop forever
	runLoop(cfg, client, fp)
}

func runLoop(cfg *config.Config, client *push.Client, fp string) {
	interval := time.Duration(cfg.Intervals.PushSeconds) * time.Second

	log.Printf("Probe loop started — pushing every %s", interval)

	var seq int64

	for {
		startTime := time.Now()

		payload, err := collect.Build(cfg, fp, seq, version)
		if err != nil {
			log.Printf("ERROR collecting telemetry: %v", err)
			time.Sleep(interval)
			continue
		}

		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			log.Printf("ERROR marshalling payload: %v", err)
			time.Sleep(interval)
			continue
		}

		sig, err := sign.Sign(payloadBytes, cfg.Token.HMACKey)
		if err != nil {
			log.Printf("WARN signing payload: %v (pushing unsigned)", err)
			sig = ""
		}

		if err := client.Push(payload, sig); err != nil {
			log.Printf("ERROR push seq=%d: %v", seq, err)
		} else {
			elapsed := time.Since(startTime).Milliseconds()
			log.Printf(
				"OK  seq=%-6d  services=%d  cpu=%.1f%%  mem=%dMB  elapsed=%dms",
				seq,
				len(payload.Services),
				payload.OS.CPUPct,
				payload.OS.MemUsedMB,
				elapsed,
			)
		}

		seq++
		time.Sleep(interval)
	}
}

// ── status ────────────────────────────────────────────────────────────────────

func cmdStatus() {
	fp, err := fingerprint.Compute()
	if err != nil {
		fmt.Printf("Host fingerprint: ERROR — %v\n", err)
	} else {
		fmt.Printf("Host fingerprint : %s\n", fp)
	}
	fmt.Printf("Probe version    : %s\n", version)
	fmt.Printf("OS               : %s\n", func() string {
		cfg, err := config.Load("/etc/openwatch/config.json")
		if err != nil {
			return "config not found"
		}
		return cfg.Token.PlatformURL
	}())
}

// ── validate ──────────────────────────────────────────────────────────────────

func cmdValidate(args []string) {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
	configPath := fs.String("config", "/etc/openwatch/config.json", "Path to config file")
	fs.Parse(args)

	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Printf("FAIL — config error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Token ID   : %s\n", cfg.Token.TokenID)
	fmt.Printf("System ID  : %s\n", cfg.Token.SystemID)
	fmt.Printf("Platform   : %s\n", cfg.Token.PlatformURL)
	fmt.Printf("Scopes     : %v\n", cfg.Token.Scopes)

	now := time.Now().Unix()
	if cfg.Token.ExpiresAt > 0 {
		if now > cfg.Token.ExpiresAt {
			fmt.Printf("Expiry     : EXPIRED (%s)\n",
				time.Unix(cfg.Token.ExpiresAt, 0).Format(time.RFC3339))
			os.Exit(1)
		}
		daysLeft := (cfg.Token.ExpiresAt - now) / 86400
		fmt.Printf("Expiry     : OK — %d days remaining (%s)\n",
			daysLeft, time.Unix(cfg.Token.ExpiresAt, 0).Format("2006-01-02"))
	}

	if cfg.Token.HMACKey == "" {
		fmt.Println("HMAC key   : MISSING — token may be old format")
	} else {
		fmt.Println("HMAC key   : OK")
	}

	if cfg.CertPEM == "" {
		fmt.Println("Client cert: NOT PROVIDED — will push without cert")
	} else {
		fmt.Println("Client cert: OK")
	}

	fmt.Println("\nToken is valid.")
}
