# Business Source License 1.1
# Copyright (c) 2026 OpenWatch
# Change Date: Four years from the release date of this file
# Change License: Apache License, Version 2.0

"""
WebSocket connection manager.

Tracks all active dashboard connections and broadcasts JSON messages to
every connected client. Dead connections are pruned silently on each broadcast.
"""

from __future__ import annotations

import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.add(ws)
        logger.info("WS client connected — total=%d", len(self._connections))

    def disconnect(self, ws: WebSocket) -> None:
        self._connections.discard(ws)
        logger.info("WS client disconnected — total=%d", len(self._connections))

    @property
    def client_count(self) -> int:
        return len(self._connections)

    async def broadcast(self, data: dict) -> None:
        """Send data to all connected clients. Removes dead connections silently."""
        if not self._connections:
            return

        dead: set[WebSocket] = set()
        for ws in list(self._connections):
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)

        if dead:
            self._connections -= dead
            logger.debug("WS pruned %d dead connections", len(dead))
