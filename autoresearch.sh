#!/bin/bash
# Autoresearch harness: Firecrawl Credit Efficiency
# Runs the dynamic benchmark and emits METRIC lines

set -e
cd "$(dirname "$0")"

# Run dynamic benchmark (outputs METRIC lines)
cmd.exe /c "node scripts/bench-credits.js"

exit 0
