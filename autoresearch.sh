#!/bin/bash
# Autoresearch harness: Firecrawl Credit Efficiency
# Runs the benchmark and emits METRIC line for the optimization loop

set -e

cd "$(dirname "$0")"

# Run benchmark
CREDITS=$(bash scripts/bench-credits.sh)

# Emit metric
echo "METRIC credits_per_extraction=$CREDITS"

exit 0
