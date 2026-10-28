#!/usr/bin/env bash
# Verifica API (via loopback) e worker. Sai com código ≠ 0 se algo estiver indisponível.
set -euo pipefail
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${ADA_PORT:-4800}${ADA_BASE_PATH:-/ada}/healthz" > /dev/null; then API=ok; break; fi
  sleep 1
done
[ "${API:-}" = ok ] || { echo "API indisponível"; exit 1; }
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${ADA_WORKER_HEALTH_PORT:-4801}/healthz" > /dev/null; then echo "API e worker OK"; exit 0; fi
  sleep 1
done
echo "Worker sem ciclo recente"; exit 1
