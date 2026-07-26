# Firecrawl Credit Efficiency Use Cases

## Easy (warmup)

### UC-1: Single page scrape
- Goal: Scrape https://example.com
- Current path: scrape (1 credit)
- Optimal path: scrape with markdown (1 credit)
- Expected: 1 credit

### UC-2: Check if URL is cached
- Goal: Re-scrape a URL that was already scraped
- Current path: scrape again (1 credit wasted)
- Optimal path: cache check → skip (0 credits)
- Expected: 0 credits (cache hit)

### UC-3: Search without scraping
- Goal: Find pages about "AI coding tools"
- Current path: search (2 credits)
- Optimal path: search only, no scrapeOptions (2 credits)
- Expected: 2 credits

## Medium

### UC-4: Map then selective scrape
- Goal: Get 3 blog posts from a 50-page site
- Current path: crawl 50 pages (50 credits)
- Optimal path: map (1 cr) + scrape 3 pages (3 cr) = 4 credits
- Expected: 4 credits (saves 46)

### UC-5: Search + top 3 scrape
- Goal: Find and read top 3 results for "firecrawl documentation"
- Current path: search + scrape all 10 results (2 + 10 = 12 credits)
- Optimal path: search (2 cr) + scrape top 3 (3 cr) = 5 credits
- Expected: 5 credits (saves 7)

### UC-6: Parse local PDF
- Goal: Extract text from a 10-page PDF
- Current path: parse (10 credits)
- Optimal path: parse with markdown only (10 credits, no JSON surcharge)
- Expected: 10 credits

## Hard

### UC-7: Full site documentation ingestion
- Goal: Scrape entire docs site (200 pages)
- Current path: crawl 200 pages (200 credits)
- Optimal path: map (1 cr) + crawl with limit (100 cr) or selective scrape
- Expected: 50-100 credits (saves 50-75%)

### UC-8: Competitive monitoring
- Goal: Monitor 5 competitor pricing pages daily for a month
- Current path: 5 pages x 30 days x 1 scrape = 150 credits
- Optimal path: monitor_create (5 monitors, ~5 credits/check x 30 checks = ~150 credits, but only charges for changes)
- Expected: ~30-50 credits (most days no changes)

### UC-9: Research + extraction pipeline
- Goal: Research "best AI coding tools 2026", extract product names and prices from top 5 results
- Current path: search (2 cr) + scrape 5 pages with JSON (5 x 5 = 25 cr) = 27 credits
- Optimal path: search (2 cr) + scrape 5 with markdown (5 cr) + parse locally if needed = 7 credits
- Expected: 7 credits (saves 20)

### UC-10: Multi-format extraction
- Goal: Get markdown + screenshots + links from 10 product pages
- Current path: 10 scrapes x (1 + 0 + 1 + 1) = 30 credits
- Optimal path: scrape markdown only (10 cr) + batch screenshots separately if needed
- Expected: 10-15 credits (saves 50%)
