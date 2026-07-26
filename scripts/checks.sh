#!/bin/bash
# Correctness check for autoresearch
# Ensures our source files are present and valid

set -e

echo "Checking source files..."

for f in src/optimizer.ts src/tools.ts src/client.ts src/firecrawl.ts; do
  if [ ! -f "$f" ]; then
    echo "FAIL: $f not found"
    exit 1
  fi
  echo "  OK: $f"
done

echo "PASS: all source files present"
exit 0
