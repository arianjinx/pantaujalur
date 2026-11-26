#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile --offline
exec bun scripts/frontier/gate.ts
