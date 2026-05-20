# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""
Cypher queries for building and querying the topology graph.

Graph schema:
  (:Host {hostname, agent_id, last_seen})
  (:Service {id, name, kind, host, port, pid, binary, health_status,
             latency_ms, last_seen, hostname})
  (:Host)-[:RUNS]->(:Service)
"""

from __future__ import annotations

# Merge a Host node and update its last_seen timestamp.
UPSERT_HOST = """
MERGE (h:Host {hostname: $hostname})
SET h.agent_id   = $agent_id,
    h.last_seen  = $last_seen
RETURN h
"""

# Merge a Service node, update all mutable properties, then ensure the
# RUNS relationship to its Host exists.
UPSERT_SERVICE = """
MERGE (s:Service {id: $id})
SET s.name          = $name,
    s.kind          = $kind,
    s.host          = $host,
    s.port          = $port,
    s.pid           = $pid,
    s.binary        = $binary,
    s.health_status = $health_status,
    s.latency_ms    = $latency_ms,
    s.last_seen     = $last_seen,
    s.hostname      = $hostname

WITH s
MATCH (h:Host {hostname: $hostname})
MERGE (h)-[:RUNS]->(s)
"""

# Return the full topology: all hosts with their services and health.
FETCH_TOPOLOGY = """
MATCH (h:Host)-[:RUNS]->(s:Service)
RETURN h.hostname      AS hostname,
       h.agent_id      AS agent_id,
       collect({
         id:            s.id,
         name:          s.name,
         kind:          s.kind,
         host:          s.host,
         port:          s.port,
         health_status: s.health_status,
         latency_ms:    s.latency_ms,
         last_seen:     s.last_seen
       }) AS services
ORDER BY h.hostname
"""
