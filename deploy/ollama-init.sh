#!/bin/sh
# Business Source License 1.1 — Copyright (c) 2026 OpenWatch
#
# Pulls the configured model into Ollama on first boot.
# Runs as a one-shot init container or can be exec'd manually:
#   docker exec openwatch-ollama /init/ollama-init.sh

MODEL="${OLLAMA_MODEL:-llama3}"

echo "Waiting for Ollama to be ready..."
until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 2
done

echo "Pulling model: $MODEL"
ollama pull "$MODEL"
echo "Model ready: $MODEL"
