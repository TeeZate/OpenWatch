# OpenWatch

**System Health Monitoring Platform** — auto-discovers your services, maps how they are wired, and warns you before things break.

> Business Source License 1.1 · Becomes Apache 2.0 four years from release.

---

## Quick Start (self-hosted)

```bash
git clone https://github.com/openwatch/openwatch
cd openwatch/deploy
docker compose up --build
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Backend docs | http://localhost:8000/docs |
| Neo4j browser | http://localhost:7474 |
| Kafka | localhost:29092 |

---

## Stack

| Layer | Technology |
|---|---|
| Agent | Go 1.22 — single binary, zero dependencies |
| Backend | Python 3.12 + FastAPI |
| Stream | Apache Kafka + Flink |
| Metrics DB | TimescaleDB (PostgreSQL 16) |
| Topology DB | Neo4j 5 |
| Live state | Redis 7 |
| AI layer | Ollama (LLaMA 3 / Mistral) |
| Dashboard | Next.js 14 + Cytoscape.js + Recharts |

---

## Build Progress

- [x] Step 1 — Docker Compose scaffold
- [x] Step 2 — Go agent: service discovery
- [x] Step 3 — Go agent: health probes
- [x] Step 4 — Go agent: emitter
- [x] Step 5 — Backend: Kafka ingestion
- [x] Step 6 — Backend: Neo4j topology builder
- [x] Step 7 — Backend: TimescaleDB metrics writer
- [x] Step 8 — Backend: Redis live state
- [x] Step 9 — Backend: REST API
- [x] Step 10 — Backend: WebSocket
- [x] Step 11 — Backend: version intelligence
- [x] Step 12 — Backend: AI risk summaries
- [x] Step 13 — Dashboard: topology map
- [x] Step 14 — Dashboard: live health
- [x] Step 15 — Dashboard: risk panel
- [x] Step 16 — Dashboard: node detail
