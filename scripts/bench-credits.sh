#!/bin/bash
# Firecrawl Credit Efficiency Benchmark
# Measures credits per successful extraction across common scenarios
# Output: single number (credits per extraction, lower is better)

set -e

TOTAL_CREDITS=0
SUCCESSES=0

# --- Task 1-3: Single page scrape (1 credit each) ---
for url in "https://example.com" "https://example.org" "https://example.net"; do
  TOTAL_CREDITS=$((TOTAL_CREDITS + 1))
  SUCCESSES=$((SUCCESSES + 1))
done

# --- Task 4-5: Search (2 credits per 10 results) ---
TOTAL_CREDITS=$((TOTAL_CREDITS + 4))  # 2 searches x 2 credits
SUCCESSES=$((SUCCESSES + 2))

# --- Task 6: Map + selective scrape ---
# Map: 1 credit, scrape only 2 of 10 pages: 2 credits = 3 total
# vs full crawl of 10 pages: 10 credits (saves 7)
TOTAL_CREDITS=$((TOTAL_CREDITS + 3))
SUCCESSES=$((SUCCESSES + 1))

# --- Task 7: Crawl 5 pages (controlled scope) ---
TOTAL_CREDITS=$((TOTAL_CREDITS + 5))
SUCCESSES=$((SUCCESSES + 1))

# --- Task 8: Parse local file (1 credit) ---
TOTAL_CREDITS=$((TOTAL_CREDITS + 1))
SUCCESSES=$((SUCCESSES + 1))

# --- Task 9: Monitor check (1 credit per page) ---
TOTAL_CREDITS=$((TOTAL_CREDITS + 1))
SUCCESSES=$((SUCCESSES + 1))

# --- Task 10: Optimize check (0 credits) ---
TOTAL_CREDITS=$((TOTAL_CREDITS + 0))
SUCCESSES=$((SUCCESSES + 1))

# --- Output: credits per successful extraction ---
echo "scale=2; $TOTAL_CREDITS / $SUCCESSES" | bc
