# OpenWatch — System Health Monitoring Platform
## Product Specification & Build Document

---

## What We Are Building

A system health monitoring platform that any sysadmin can plug into an existing software environment — online or offline — and instantly see:

- A live visual map of all services, database connections, and API dependencies (auto-discovered, no manual config)
- Real-time health status of every node — latency, uptime, error rates, connection pool status
- Predictive failure warnings before things break — EOL libraries, version incompatibilities, capacity trends
- Error logs, redundancy status, and out-of-date or incompatible components ranked by blast radius

**The core problem it solves:** Tools like Datadog and New Relic show you metrics. They do not show you your system. There is no tool that automatically maps how your services are wired, then layers intelligence on top to tell you what is going to break before it breaks.

---

## What Does Not Exist Yet

Datadog, New Relic, Grafana, and Prometheus all share the same gap:

- Require weeks of manual configuration
- Output dashboards of numbers, not a live system map
- Alert after things break, not before
- Built for large DevOps teams, not individual sysadmins
- Cost $15-$30 per host per month

**Our target user:** The sysadmin at a 50-200 person company running a mix of legacy and modern systems, with no dedicated DevOps team, who cannot afford to spend weeks configuring dashboards.

---

## Business Model — Open Core

The agent and core engine are fully open source. Revenue comes from everything around it.

| Open Source (Free) | Commercial (Paid) |
|---|---|
| Core Go agent | Cloud hosted dashboard |
| Topology discovery engine | Team collaboration features |
| Health checks | Role-based access control |
| Local dashboard | SSO / enterprise auth |
| Self-hosted deployment | SLA and support contracts |
| | Advanced AI predictions |
| | Multi-environment management |
| | Compliance reporting |
| | API access |

**License:** Business Source License (BSL) — source available, protects against AWS-style commoditisation, becomes fully open source after 4 years. Same model as HashiCorp.

**Revenue streams:**
1. Cloud SaaS — $0 (up to 3 hosts) / $20 per host per month (Pro) / Custom (Enterprise)
2. Support contracts — $2,000-$10,000/month for enterprise self-hosted customers
3. Managed on-premise — license fee for air-gapped deployments (banks, government, UAE public sector)

---

## Core Product — Three Layers

### Layer 1 — Automatic Topology Mapping
Agent installs in minutes, scans the environment, and draws a live visual graph of every service, database, API dependency, and network connection. No manual configuration. The map builds itself.

### Layer 2 — Live Health Intelligence
Every node on the map is live — green, yellow, red. Click any node to see response latency, uptime, error rate, connection pool status, and recent logs.

### Layer 3 — Predictive Failure Intelligence (The Moat)
AI layer that:
- Detects EOL (end of life) libraries and maps which services depend on them
- Identifies connected services running incompatible versions
- Spots database connection pools trending toward capacity limits
- Warns when third-party API endpoints your system depends on are deprecated
- Ranks every risk by likelihood and blast radius
- Outputs plain English summaries: *"Your Redis 6.2 instance is EOL and is a dependency of 4 critical services. Estimated blast radius if it fails: full checkout flow down."*

---

## Tech Stack

### Agent — Go
Runs on the customer's server. Compiles to a single binary — no dependency installation, no runtime, no virtualenv. Cross-compiles to Linux, Windows, and macOS. Low memory footprint, high concurrency. Same approach used by Prometheus, Grafana Agent, and Datadog's agent.

**What the agent does:**
- Port scanning and process inspection to auto-discover running services
- Config file parsing to detect database connections and service relationships
- Health check probes (HTTP, TCP, database ping, queue depth)
- Package manifest scanning (requirements.txt, package.json, pom.xml) for version data
- Emits structured events over TLS to the backend

### Backend — Python + FastAPI
Async API layer. Auto-generates OpenAPI documentation. Hosts the AI intelligence layer. Interfaces with all databases.

### Stream Processing — Apache Kafka + Apache Flink
- **Kafka:** Every health check, metric, and event from every agent flows into Kafka first. Decouples ingestion from processing. Buffers data if the AI layer is slow. Nothing gets lost at scale.
- **Flink:** Sits on top of Kafka. Processes the stream in real time — rolling averages, anomaly detection, alert triggers.

### Databases — Three, Each Doing a Specific Job

| Database | Type | Purpose |
|---|---|---|
| TimescaleDB | PostgreSQL extension | Time-series metrics — latency, error rates, uptime history |
| Neo4j | Graph database | Topology map — services and connections as nodes and edges |
| Redis | In-memory store | Live health state — sub-millisecond reads for real-time dashboard |

### AI / Intelligence Layer — Ollama + LLaMA 3 / Mistral
Self-hosted open source LLMs. Not OpenAI. A sysadmin trusting you with their infrastructure topology cannot have that data sent to a third-party API. Ollama runs the model locally — on your servers for cloud customers, on their servers for self-hosted customers. Same codebase, different deployment.

Cross-references:
- CVE databases for known vulnerabilities
- PyPI, npm, Maven registries for EOL and deprecation data
- Internal topology graph for blast radius analysis

### Frontend — Next.js 14
- **Next.js 14** (App Router) — React framework, server-side rendering
- **Cytoscape.js** — Live interactive topology map, handles thousands of nodes
- **Recharts** — Time-series charts for latency, error rates, uptime
- **Tailwind CSS** — Utility-first styling, easy for open source contributors

### Infrastructure

| Tool | Purpose |
|---|---|
| Docker + Docker Compose | Full stack ships as `docker-compose.yml` — self-hosting is `git clone` → `docker compose up` |
| Kubernetes + Helm Charts | Enterprise and cloud deployment |
| Terraform | Infrastructure as code for cloud and enterprise self-hosted provisioning |
| GitHub Actions | CI/CD, automated testing on every PR |

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CUSTOMER SERVERS                    │
│                                                      │
│   Go Agent (single binary, auto-discovers topology)  │
│   - Port scan & process inspection                   │
│   - Config file parsing                              │
│   - Health check probes                              │
│   - Package manifest scanning                        │
└──────────────────────┬──────────────────────────────┘
                       │ Encrypted (TLS)
                       ▼
┌─────────────────────────────────────────────────────┐
│                   BACKEND ENGINE                     │
│                                                      │
│  Kafka (ingestion) → Flink (stream processing)       │
│         ↓                  ↓                         │
│   TimescaleDB           Neo4j            Redis       │
│   (metrics)           (topology)      (live state)   │
│         ↓                  ↓                ↓        │
│              FastAPI (REST + WebSocket API)           │
│                           ↓                          │
│              Ollama / LLaMA (AI layer)                │
│              - CVE database queries                   │
│              - Package registry checks               │
│              - Blast radius analysis                  │
│              - Plain English risk summaries           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                  NEXT.JS DASHBOARD                   │
│                                                      │
│  Live topology map (Cytoscape.js)                    │
│  Health metrics & charts (Recharts)                  │
│  AI risk summaries & predictions                     │
│  Alert management                                    │
│  Component version & EOL warnings                    │
└─────────────────────────────────────────────────────┘
```

---

## MVP Scope — Build This First

Do not build everything. Build one complete vertical slice that demonstrates the full value proposition.

### MVP Deliverables

**1. Go Agent (Core)**
- Auto-discovers: running processes, open ports, HTTP services, PostgreSQL, MySQL, MongoDB, Redis connections
- Reads: requirements.txt, package.json, pom.xml for dependency versions
- Emits: structured JSON events to backend every 30 seconds
- Single binary, zero dependencies, runs on Linux

**2. Topology Engine**
- Receives agent events, builds graph in Neo4j
- REST endpoint returns full topology as JSON for frontend
- WebSocket endpoint streams live state changes

**3. Health Check Engine**
- HTTP probe: GET /health on discovered HTTP services
- Database probe: connection ping with latency measurement
- Stores results in TimescaleDB with timestamps
- Live state (latest reading per node) cached in Redis

**4. Version Intelligence (Basic)**
- Reads package manifests from agent
- Queries PyPI and npm for latest stable version
- Flags packages more than 2 major versions behind
- Flags packages with known CVEs (query OSV.dev — free, open API)

**5. Dashboard**
- Topology map: interactive graph, colour-coded by health status
- Node detail panel: click any node to see latency, uptime, version warnings
- Risk panel: list of flagged issues ranked by severity
- No auth required for MVP — single user, local or cloud

**6. Docker Compose**
- One command brings up the full stack locally
- Includes agent pointed at the local environment for a self-demo

---

## What The AI Risk Summary Looks Like (Target Output)

```
CRITICAL — Redis 6.2.6 (3 dependents)
Redis 6.2 reached end of life March 2025. Services depending on this 
instance: checkout-api, session-manager, cart-service. If this instance 
fails, all three services lose session state. Recommended action: upgrade 
to Redis 7.2 or migrate to Redis Cloud managed service.

WARNING — requests 2.18.0 (checkout-api)
Package is 6 major versions behind current stable (2.31.0). Known CVE: 
CVE-2023-32681 (moderate). Upgrade recommended before next deployment.

WATCH — PostgreSQL connection pool (orders-db)
Connection pool utilisation averaged 79% over the last 6 hours, up from 
61% last week. At current growth rate, pool exhaustion projected within 
11 days. Consider increasing max_connections or adding a read replica.
```

---

## Repository Structure

```
openwatch/
├── agent/                  # Go agent
│   ├── cmd/
│   ├── internal/
│   │   ├── discovery/      # Service auto-discovery
│   │   ├── probes/         # Health check probes
│   │   ├── collector/      # Metric collection
│   │   └── emitter/        # Backend communication
│   └── Dockerfile
├── backend/                # Python + FastAPI
│   ├── api/                # REST + WebSocket endpoints
│   ├── stream/             # Kafka consumers, Flink jobs
│   ├── intelligence/       # AI layer, CVE queries, version checks
│   ├── models/             # Database models
│   └── Dockerfile
├── dashboard/              # Next.js frontend
│   ├── app/
│   ├── components/
│   │   ├── topology/       # Cytoscape.js map
│   │   ├── health/         # Metrics charts
│   │   └── risks/          # AI risk panel
│   └── Dockerfile
├── deploy/
│   ├── docker-compose.yml  # Local / self-hosted
│   ├── helm/               # Kubernetes chart
│   └── terraform/          # Cloud provisioning
├── docs/
└── README.md
```

---

## Build Order for Claude Code

Build in this exact sequence. Each step produces something that runs and can be tested before moving to the next.

1. **Docker Compose scaffold** — empty services, all containers talking to each other
2. **Go agent — service discovery** — discovers processes and ports, prints JSON to stdout
3. **Go agent — health probes** — adds HTTP and database health checks to discovered services
4. **Go agent — emitter** — sends structured events to backend via HTTP
5. **Backend — Kafka ingestion** — receives agent events, publishes to Kafka topic
6. **Backend — Neo4j topology builder** — consumes Kafka, builds graph
7. **Backend — TimescaleDB metrics writer** — consumes Kafka, writes time-series data
8. **Backend — Redis live state** — maintains current health state per node
9. **Backend — REST API** — topology endpoint, health endpoint, risk endpoint
10. **Backend — WebSocket** — streams live state changes to dashboard
11. **Backend — version intelligence** — package manifest parsing, PyPI/npm/OSV queries
12. **Backend — AI risk summaries** — Ollama integration, prompt engineering, risk ranking
13. **Dashboard — topology map** — Cytoscape.js graph rendering topology API data
14. **Dashboard — live health** — colour-coded nodes updating via WebSocket
15. **Dashboard — risk panel** — displays AI-generated risk summaries
16. **Dashboard — node detail** — click a node, see full health breakdown

---

## Key Engineering Decisions to Communicate to Claude Code

- **Agent must be a single compiled binary** — no runtime dependencies on target server
- **All LLM inference runs locally via Ollama** — no external API calls for AI features
- **Self-hosting must work with `docker compose up`** — zero additional configuration
- **WebSocket for live updates** — do not poll the REST API from the frontend
- **Neo4j for topology** — do not model service relationships in PostgreSQL
- **TimescaleDB for metrics** — do not store time-series data in a general-purpose database
- **BSL license on all files** — include license header in every source file

---

## Success Criteria for MVP

- [ ] Agent discovers services on a standard Linux server with no configuration
- [ ] Topology map renders within 30 seconds of agent starting
- [ ] Health status updates in real time on the dashboard
- [ ] At least one meaningful AI risk summary generated from a real environment
- [ ] Full stack runs locally with `docker compose up`
- [ ] README contains self-hosting instructions completable in under 10 minutes
