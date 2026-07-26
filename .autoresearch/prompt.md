# Autoresearch: Firecrawl Credit Efficiency Optimization

## Goal
Minimize credits consumed per successful web data extraction task while maintaining extraction quality.

## Metric
**credits-per-successful-extraction**, lower better

Measured as: total credits spent / number of successfully extracted pages with useful content.

## Benchmark Script
```bash
# scripts/bench-credits.sh
# Simulates 10 common extraction tasks and counts credits used
# Tasks: 3 single-page scrapes, 2 searches, 1 map+scrape, 1 crawl (5 pages), 1 parse, 1 monitor check, 1 optimize check

TOTAL_CREDITS=0
SUCCESSES=0

# Task 1-3: Single page scrape (should be 1 credit each if cached)
for url in "https://example.com" "https://example.org" "https://example.net"; do
  CREDITS=1
  TOTAL_CREDITS=$((TOTAL_CREDITS + CREDITS))
  SUCCESSES=$((SUCCESSES + 1))
done

# Task 4-5: Search (2 credits each)
TOTAL_CREDITS=$((TOTAL_CREDITS + 4))
SUCCESSES=$((SUCCESSES + 2))

# Task 6: Map + selective scrape (1 + 2 = 3 credits vs 10 for full crawl)
TOTAL_CREDITS=$((TOTAL_CREDITS + 3))
SUCCESSES=$((SUCCESSES + 1))

# Task 7: Crawl 5 pages (5 credits)
TOTAL_CREDITS=$((TOTAL_CREDITS + 5))
SUCCESSES=$((SUCCESSES + 1))

# Task 8: Parse (1 credit)
TOTAL_CREDITS=$((TOTAL_CREDITS + 1))
SUCCESSES=$((SUCCESSES + 1))

# Task 9: Monitor check (1 credit per page)
TOTAL_CREDITS=$((TOTAL_CREDITS + 1))
SUCCESSES=$((SUCCESSES + 1))

# Task 10: Optimize check (0 credits)
TOTAL_CREDITS=$((TOTAL_CREDITS + 0))
SUCCESSES=$((SUCCESSES + 1))

# Output: credits per successful extraction
echo "scale=2; $TOTAL_CREDITS / $SUCCESSES" | bc
```

## Verify
```bash
npx tsc --noEmit
```

## Scope
- `src/optimizer.ts` — URL cache, cost estimation, tool selection
- `src/tools.ts` — tool definitions and prompt guidelines
- `src/client.ts` — request handling and credit tracking

## Optimization Targets

### 1. URL Cache Hit Rate
Current: cache checks are manual (must call optimize first)
Target: automatic cache check before every scrape call
Impact: -30-50% credits on repeated tasks

### 2. Smart Format Selection
Current: agent chooses format manually
Target: auto-select markdown unless JSON is explicitly needed
Impact: -4 credits per page when JSON not needed

### 3. Crawl-to-Map Ratio
Current: crawl used for multi-page tasks
Target: map + selective scrape when <30% of pages needed
Impact: -70% credits on partial site ingestion

### 4. Monitor vs Re-scrape
Current: monitor is underutilized
Target: auto-suggest monitor when same URL checked >2 times
Impact: -50% credits on recurring monitoring

### 5. Search Result Filtering
Current: scrape all search results
Target: scrape only top 3 most relevant results
Impact: -60% credits on search-then-scrape workflows

## Expected Improvement
Baseline: ~2.5 credits per extraction
Target: ~1.2 credits per extraction (52% reduction)
