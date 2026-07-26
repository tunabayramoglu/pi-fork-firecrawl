#!/bin/bash
# Correctness check for autoresearch
# Ensures typecheck passes after each optimization attempt

set -e

echo "Running typecheck..."
npx tsc --noEmit 2>&1

if [ $? -eq 0 ]; then
  echo "PASS: typecheck succeeded"
  exit 0
else
  echo "FAIL: typecheck failed"
  exit 1
fi
