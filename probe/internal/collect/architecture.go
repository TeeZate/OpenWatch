// Business Source License 1.1
// Copyright (c) 2026 OpenWatch

// Package collect — system architecture discovery.
// Scans environment variable KEY NAMES (never values) to detect external
// service integrations (Stripe, Resend, AWS, etc.), CORS frontend origins,
// hosting provider, and runtime version. Runs as part of the extended
// collector cycle (~every 5 minutes).

package collect

import (
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
