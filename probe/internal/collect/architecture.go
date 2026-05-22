// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package collect — system architecture discovery.
// Scans environment variable KEY NAMES (never values) to detect external
// service integrations (Stripe, Resend, AWS, etc.), CORS frontend origins,
// hosting provider, and runtime version. Runs as part of the extended
// collector cycle (~every 5 minutes).

package collect

import (
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ── Integration detection patterns ────────────────────────────────────────────

var integrationPatterns = []struct {
	Prefix string
	Name   string
	Kind   string
	Icon   string
}{
	{"STRIPE_",          "Stripe",        "payment",    "💳"},
	{"PAYPAL_",          "PayPal",        "payment",    "💰"},
	{"BRAINTREE_",       "Braintree",     "payment",    "💳"},
	{"SQUARE_",          "Square",        "payment",    "💳"},
	{"LEMON_",           "Lemon Squeezy", "payment",    "🍋"},
	{"PADDLE_",          "Paddle",        "payment",    "🏓"},
	{"RESEND_",          "Resend",        "email",      "📧"},
	{"SENDGRID_",        "SendGrid",      "email",      "📧"},
	{"MAILGUN_",         "Mailgun",       "email",      "📧"},
	{"POSTMARK_",        "Postmark",      "email",      "📧"},
	{"SMTP_",            "SMTP",          "email",      "📧"},
	{"TWILIO_",          "Twilio",        "sms",        "💬"},
	{"VONAGE_",          "Vonage",        "sms",        "💬"},
	{"AWS_",             "AWS",           "cloud",      "☁"},
	{"S3_BUCKET",        "AWS S3",        "storage",    "📦"},
	{"GCS_",             "GCS",           "storage",    "📦"},
	{"CLOUDINARY_",      "Cloudinary",    "storage",    "🖼"},
	{"BUNNY_",           "Bunny CDN",     "storage",    "📦"},
	{"SUPABASE_",        "Supabase",      "database",   "🗄"},
	{"FIREBASE_",        "Firebase",      "database",   "🔥"},
	{"OPENAI_",          "OpenAI",        "ai",         "🤖"},
	{"ANTHROPIC_",       "Anthropic",     "ai",         "🤖"},
	{"GEMINI_",          "Gemini",        "ai",         "🤖"},
	{"COHERE_",          "Cohere",        "ai",         "🤖"},
	{"REPLICATE_",       "Replicate",     "ai",         "🤖"},
	{"PUSHER_",          "Pusher",        "realtime",   "⚡"},
	{"ABLY_",            "Ably",          "realtime",   "⚡"},
	{"LIVEKIT_",         "LiveKit",       "realtime",   "🎙"},
	{"DATADOG_",         "Datadog",       "monitoring", "📊"},
	{"SENTRY_",          "Sentry",        "monitoring", "🐛"},
	{"NEW_RELIC_",       "New Relic",     "monitoring", "📈"},
	{"LOGTAIL_",         "Logtail",       "monitoring", "📋"},
	{"UPSTASH_",         "Upstash Redis", "cache",      "⚡"},
	{"AUTH0_",           "Auth0",         "auth",       "🔐"},
	{"CLERK_",           "Clerk",         "auth",       "🔐"},
	{"OKTA_",            "Okta",          "auth",       "🔐"},
	{"WEBAUTHN_",        "WebAuthn",      "auth",       "🔑"},
	{"JWT_",             "JWT",           "auth",       "🔑"},
	{"GITHUB_",          "GitHub",        "vcs",        "🐙"},
	{"GITLAB_",          "GitLab",        "vcs",        "🦊"},
	{"HUBSPOT_",         "HubSpot",       "crm",        "🏢"},
	{"SALESFORCE_",      "Salesforce",    "crm",        "☁"},
	{"ALGOLIA_",         "Algolia",       "search",     "🔍"},
	{"KAFKA_",           "Kafka",         "queue",      "📨"},
	{"RABBITMQ_",        "RabbitMQ",      "queue",      "📨"},
	{"SQS_",             "AWS SQS",       "queue",      "📨"},
	{"QSTASH_",          "QStash",        "queue",      "📨"},
	{"INNGEST_",         "Inngest",       "queue",      "📨"},
}

// corsEnvVars lists env var names that typically contain frontend origin URLs.
var corsEnvVars = []string{
	"CORS_ORIGIN", "CORS_ORIGINS", "ALLOWED_ORIGINS", "ALLOWED_ORIGIN",
	"CLIENT_URL", "FRONTEND_URL", "FRONTEND_URLS", "APP_URL", "WEBAPP_URL",
	"NEXT_PUBLIC_APP_URL", "VITE_APP_URL", "REACT_APP_URL",
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ArchIntegration struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	EnvKey string `json:"env_key"` // key name only — never the value
	Icon   string `json:"icon,omitempty"`
}

type ArchitectureInfo struct {
	Hosting      string            `json:"hosting,omitempty"`
	Runtime      string            `json:"runtime,omitempty"`
	Integrations []ArchIntegration `json:"integrations"`
	CORSOrigins  []string          `json:"cors_origins,omitempty"`
	CollectedAt  string            `json:"collected_at"`
}

// ── Collector ─────────────────────────────────────────────────────────────────

// CollectArchitecture scans environment variable keys (not values) to detect
// what external services the monitored application uses, its frontend origins
// and hosting provider.
func CollectArchitecture() ArchitectureInfo {
	ts := time.Now().UTC().Format(time.RFC3339)
	info := ArchitectureInfo{
		CollectedAt: ts,
		Hosting:     detectHostingProvider(),
		Runtime:     detectRuntimeVersion(),
	}

	// Scan all env var keys for integration patterns
	seen := map[string]bool{}
	for _, envEntry := range os.Environ() {
		key := strings.SplitN(envEntry, "=", 2)[0]
		keyUpper := strings.ToUpper(key)

		for _, pat := range integrationPatterns {
			if seen[pat.Name] {
				continue
			}
			if strings.HasPrefix(keyUpper, pat.Prefix) {
				info.Integrations = append(info.Integrations, ArchIntegration{
					Name:   pat.Name,
					Kind:   pat.Kind,
					EnvKey: key,
					Icon:   pat.Icon,
				})
				seen[pat.Name] = true
				break
			}
		}
	}

	// Collect CORS origins from well-known env vars
	originSeen := map[string]bool{}
	for _, varName := range corsEnvVars {
		val := os.Getenv(varName)
		if val == "" {
			continue
		}
		for _, origin := range strings.Split(val, ",") {
			origin = strings.TrimSpace(origin)
			if origin == "" || !strings.HasPrefix(origin, "http") {
				continue
			}
			if !originSeen[origin] {
				originSeen[origin] = true
				info.CORSOrigins = append(info.CORSOrigins, origin)
			}
		}
	}

	return info
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func detectHostingProvider() string {
	checks := []struct{ env, name string }{
		{"RAILWAY_ENVIRONMENT",         "Railway"},
		{"RAILWAY_SERVICE_ID",          "Railway"},
		{"FLY_APP_NAME",                "Fly.io"},
		{"RENDER_SERVICE_ID",           "Render"},
		{"HEROKU_APP_ID",               "Heroku"},
		{"K_SERVICE",                   "Cloud Run"},
		{"GOOGLE_CLOUD_PROJECT",        "Google Cloud"},
		{"AWS_LAMBDA_FUNCTION_NAME",    "AWS Lambda"},
		{"AWS_EXECUTION_ENV",           "AWS"},
		{"VERCEL",                      "Vercel"},
		{"VERCEL_URL",                  "Vercel"},
		{"NETLIFY",                     "Netlify"},
		{"DENO_DEPLOYMENT_ID",          "Deno Deploy"},
		{"CF_PAGES",                    "Cloudflare Pages"},
	}
	for _, c := range checks {
		if os.Getenv(c.env) != "" {
			return c.name
		}
	}
	return ""
}

// ── Zero-config auto-discovery ────────────────────────────────────────────────

// AutoDiscoverServiceURL tries to find the base URL of the monitored API from
// well-known environment variables injected by hosting providers. Returns ""
// if nothing is found — the caller falls back to the platform-configured value.
func AutoDiscoverServiceURL() string {
	checks := []struct{ env, prefix string }{
		// Railway injects RAILWAY_PUBLIC_DOMAIN for services with a public domain
		{"RAILWAY_PUBLIC_DOMAIN", "https://"},
		// Render sets this for web services
		{"RENDER_EXTERNAL_URL", ""},
		// Fly.io
		{"FLY_PUBLIC_HOSTNAME", "https://"},
		// Generic hosting patterns (values usually include the scheme already)
		{"APP_URL", ""},
		{"API_URL", ""},
		{"PUBLIC_URL", ""},
		{"BASE_URL", ""},
		{"SERVICE_URL", ""},
		{"SERVER_URL", ""},
		{"BACKEND_URL", ""},
		{"NEXT_PUBLIC_API_URL", ""},
		{"VITE_API_URL", ""},
		{"REACT_APP_API_URL", ""},
	}
	for _, c := range checks {
		v := strings.TrimSpace(os.Getenv(c.env))
		if v == "" {
			continue
		}
		if c.prefix != "" && !strings.HasPrefix(v, "http") {
			v = c.prefix + v
		}
		if strings.HasPrefix(v, "http") {
			return strings.TrimRight(v, "/")
		}
	}
	return ""
}

// DiscoverCORSOriginsFromService probes the given service URL with an HTTP
// OPTIONS preflight request and returns any specific frontend origins advertised
// in the Access-Control-Allow-Origin response header. Returns nil when the API
// uses a wildcard (*), is unreachable, or returns no CORS headers at all.
//
// Additionally checks every value in corsEnvVars on the probe service itself —
// if the admin copied e.g. CORS_ORIGIN from their app to the probe service,
// those origins are collected here too.
func DiscoverCORSOriginsFromService(serviceURL string) []string {
	seen := map[string]bool{}
	var origins []string

	addOrigin := func(o string) {
		o = strings.TrimSpace(o)
		if o == "" || o == "*" || !strings.HasPrefix(o, "http") {
			return
		}
		if !seen[o] {
			seen[o] = true
			origins = append(origins, o)
		}
	}

	// ── 1. Live CORS headers from the service ─────────────────────────────────
	if serviceURL != "" {
		client := &http.Client{Timeout: 8 * time.Second}
		// Send a preflight with a synthetic probe origin so we can see what the
		// server reflects. Many frameworks echo back the origin when it matches
		// their allowlist — we send a few plausible-looking patterns.
		probeOrigins := []string{
			"https://app.example.com",
			"https://localhost",
			"https://localhost:3000",
		}
		for _, probe := range probeOrigins {
			req, err := http.NewRequest(http.MethodOptions, serviceURL, nil)
			if err != nil {
				break
			}
			req.Header.Set("Origin", probe)
			req.Header.Set("Access-Control-Request-Method", "GET")
			resp, err := client.Do(req)
			if err != nil {
				break
			}
			resp.Body.Close()
			// If the server echoed back this specific origin it means their
			// allowlist pattern matched — note it (it tells us CORS is configured
			// but doesn't reveal the real origins).
			// More useful: check the VARY header to know if origin-based CORS is active.
			_ = resp.Header.Get("Vary")

			// Some servers include an explicit allowlist in a custom header or
			// embed it in error responses — but the most useful signal is simply
			// checking the reflect pattern. We skip adding probe origins to the list.
		}

		// Make a plain GET and look at the allow-origin header value.
		req, err := http.NewRequest(http.MethodGet, serviceURL, nil)
		if err == nil {
			req.Header.Set("User-Agent", "OpenWatch-Probe/1.0 (cors-discovery)")
			if resp, err := client.Do(req); err == nil {
				resp.Body.Close()
				for _, val := range resp.Header.Values("Access-Control-Allow-Origin") {
					for _, part := range strings.Split(val, ",") {
						addOrigin(strings.TrimSpace(part))
					}
				}
			}
		}
	}

	// ── 2. CORS env vars on the probe service (values, not just keys) ─────────
	// Frontend URLs are public information — safe to read and report.
	for _, varName := range corsEnvVars {
		val := os.Getenv(varName)
		if val == "" {
			continue
		}
		for _, part := range strings.Split(val, ",") {
			part = strings.TrimSpace(part)
			// Filter to http origins only; skip plain hostnames or paths
			if u, err := url.Parse(part); err == nil && u.Scheme != "" && u.Host != "" {
				addOrigin(part)
			}
		}
	}

	return origins
}

func detectRuntimeVersion() string {
	pairs := []struct{ env, prefix string }{
		{"NODE_VERSION",            "Node.js "},
		{"PYTHON_VERSION",         "Python "},
		{"RUBY_VERSION",           "Ruby "},
		{"GO_VERSION",             "Go "},
		{"JAVA_TOOL_OPTIONS",      "Java"},
		{"NIXPACKS_NODE_VERSION",  "Node.js"},
		{"NIXPACKS_PYTHON_VERSION","Python"},
		{"NIXPACKS_GO_VERSION",    "Go"},
	}
	for _, p := range pairs {
		if v := os.Getenv(p.env); v != "" {
			return strings.TrimSpace(p.prefix + v)
		}
	}
	return ""
}
