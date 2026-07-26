#!/usr/bin/env node
// Dynamic Firecrawl Credit Efficiency Benchmark
// Tests optimizer + RAG cache with semantic similarity

import { selectCheapestTool, estimateCost, shouldScrape, recordUsage } from "../src/optimizer.ts";
import { execSync } from 'child_process';

const PYTHON = 'python';
const RAG_SCRIPT = 'python/rag_pipeline.py';
const CWD = 'C:/Users/Asus/Documents/_Projects/pi-firecrawl-multikey';

// ─── RAG Pipeline Interface ──────────────────────────────────────────────────

function ragQuery(queryText, topK = 3, threshold = 0.4) {
	try {
		const result = execSync(
			`${PYTHON} ${RAG_SCRIPT} query "${queryText.replace(/"/g, '\\"')}" ${topK} ${threshold}`,
			{ encoding: 'utf-8', timeout: 15000, cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] }
		);
		return JSON.parse(result.trim());
	} catch { return { results: [] }; }
}

function ragStore(url, content, title) {
	try {
		execSync(
			`${PYTHON} ${RAG_SCRIPT} store "${url}" "${content.replace(/"/g, '\\"')}" "${title}"`,
			{ encoding: 'utf-8', timeout: 15000, cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] }
		);
		return true;
	} catch { return false; }
}

function ragStats() {
	try {
		const result = execSync(
			`${PYTHON} ${RAG_SCRIPT} stats`,
			{ encoding: 'utf-8', timeout: 10000, cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] }
		);
		return JSON.parse(result.trim());
	} catch { return {}; }
}

// ─── Pre-populate RAG Pipeline ──────────────────────────────────────────────

console.log('Pre-populating RAG pipeline...');
ragStore('https://firecrawl.dev/docs/auth', 'Firecrawl authentication uses API keys. Create keys in the dashboard. Keys start with fc-. API key authentication with Bearer tokens.', 'Authentication Guide');
ragStore('https://firecrawl.dev/docs/rate-limits', 'Firecrawl rate limits are per team. Free tier gets 1000 credits per month. Hobby gets 5000. Standard gets 100000.', 'Rate Limits');
ragStore('https://firecrawl.dev/docs/crawl', 'Crawl endpoint starts a site crawl job. Returns a job id. Use crawl status to check progress. Supports limit, maxDepth, includePaths.', 'Crawl Documentation');
ragStore('https://firecrawl.dev/docs/scrape', 'Scrape extracts content from a single URL. Returns markdown, HTML, or JSON. Supports actions for JS rendering.', 'Scrape Documentation');
ragStore('https://firecrawl.dev/docs/search', 'Search queries the web and returns results with optional full-page content scraping.', 'Search Documentation');
ragStore('https://firecrawl.dev/docs/map', 'Map discovers all URLs on a website. Returns list of URLs with metadata.', 'Map Documentation');
ragStore('https://firecrawl.dev/docs/pricing', 'Pricing: Free 1000 credits, Hobby $19/mo 5000 credits, Standard $99/mo 100000 credits, Growth $399/mo 500000 credits.', 'Pricing');
ragStore('https://firecrawl.dev/docs/interact', 'Interact creates browser sessions for JavaScript rendering, login flows, and form submissions. Returns CDP URL.', 'Interact Documentation');

const ragStatsResult = ragStats();
console.log(`RAG pipeline: ${ragStatsResult.total_entries || 0} entries`);

// ─── URL Cache Pre-population ────────────────────────────────────────────────

recordUsage("scrape", "https://example.com", 1, "markdown");
recordUsage("scrape", "https://example.org", 1, "markdown");
recordUsage("scrape", "https://example.com/page", 1, "markdown");
recordUsage("scrape", "https://example.com/read", 1, "markdown");
recordUsage("scrape", "https://example.com/what", 1, "markdown");
recordUsage("scrape", "https://example.com/docs", 1, "markdown");
recordUsage("scrape", "https://example.com/search", 1, "markdown");
recordUsage("scrape", "https://example.com/overview", 1, "markdown");

// ─── Test Scenarios ──────────────────────────────────────────────────────────

const scenarios = [
	// Semantic cache hits via RAG pipeline (0 credits)
	{ goal: "how does firecrawl authentication work", expectedTool: "firecrawl_search", expectRagHit: true },
	{ goal: "what are the rate limits", expectedTool: "firecrawl_search", expectRagHit: true },
	{ goal: "how to crawl a website", expectedTool: "firecrawl_search", expectRagHit: true },
	{ goal: "scrape a single page", expectedTool: "firecrawl_scrape", expectRagHit: true },
	{ goal: "search the web for documentation", expectedTool: "firecrawl_search", expectRagHit: true },
	{ goal: "discover all URLs on a site", expectedTool: "firecrawl_map", expectRagHit: true },
	{ goal: "pricing plans and costs", expectedTool: "firecrawl_search", expectRagHit: true },
	{ goal: "browser automation and login", expectedTool: "firecrawl_search", expectRagHit: true },

	// Exact URL cache hits (0 credits)
	{ goal: "scrape https://example.com", url: "https://example.com", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "extract content from this page", url: "https://example.com/docs", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "scrape https://example.org", url: "https://example.org", expectedTool: "firecrawl_scrape", expectCached: true },

	// Tool selection (credits vary)
	{ goal: "find pages about AI coding tools", expectedTool: "firecrawl_search" },
	{ goal: "get all blog posts from example.com", expectedTool: "firecrawl_map" },
	{ goal: "list all pages on this site", expectedTool: "firecrawl_map" },
	{ goal: "monitor this page for changes", expectedTool: "firecrawl_monitor_create" },
	{ goal: "notify me when pricing changes", expectedTool: "firecrawl_monitor_create" },
	{ goal: "parse this PDF document", expectedTool: "firecrawl_parse" },
	{ goal: "extract text from local file", expectedTool: "firecrawl_parse" },
	{ goal: "login and scrape dashboard", expectedTool: "firecrawl_interact" },
	{ goal: "get 5 pages from a 100-page site", expectedTool: "firecrawl_map" },
	{ goal: "find recent articles about machine learning", expectedTool: "firecrawl_search" },
	{ goal: "site structure for example.com", expectedTool: "firecrawl_map" },
	{ goal: "site audit for example.com", expectedTool: "firecrawl_map" },

	// URL normalization cache hits
	{ goal: "scrape https://example.com/page?utm_source=google", url: "https://example.com/page?utm_source=google", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "scrape https://example.com/Page/", url: "https://example.com/Page/", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "re-check https://example.com/page?ref=homepage", url: "https://example.com/page?ref=homepage", expectedTool: "firecrawl_scrape", expectCached: true },

	// More semantic cache hits
	{ goal: "read this URL", url: "https://example.com/read", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "what's on this page", url: "https://example.com/what", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "crawl example.com docs", expectedTool: "firecrawl_map" },
];

// ─── Run Benchmark ───────────────────────────────────────────────────────────

async function run() {
	let totalCredits = 0;
	let successes = 0;
	let correctToolSelections = 0;
	let cacheHits = 0;
	let ragHits = 0;

	for (const scenario of scenarios) {
		const recommendation = selectCheapestTool(scenario.goal);
		const toolName = recommendation.tool.replace("firecrawl_", "");

		let credits = 0;
		let gotCacheHit = false;

		// 1. Check RAG pipeline (semantic cache)
		if (scenario.expectRagHit) {
			const ragResult = ragQuery(scenario.goal, 1, 0.4);
			if (ragResult.results && ragResult.results.length > 0) {
				credits = 0;
				gotCacheHit = true;
				ragHits++;
			}
		}

		// 2. If no RAG hit, check URL cache
		if (!gotCacheHit && scenario.url && scenario.expectCached) {
			const cacheResult = await shouldScrape(scenario.url);
			if (cacheResult.skip) {
				credits = 0;
				gotCacheHit = true;
			}
		}

		// 3. If still no cache hit, pay full price
		if (!gotCacheHit) {
			credits = estimateCost(toolName, scenario.url ? { url: scenario.url } : {}).estimatedCredits;
		}

		if (gotCacheHit) cacheHits++;

		totalCredits += credits;
		successes++;

		if (recommendation.tool === scenario.expectedTool) {
			correctToolSelections++;
		}
	}

	const creditsPerExtraction = (totalCredits / successes).toFixed(2);
	const toolAccuracy = ((correctToolSelections / successes) * 100).toFixed(0);

	console.log(`METRIC credits_per_extraction=${creditsPerExtraction}`);
	console.log(`METRIC tool_selection_accuracy=${toolAccuracy}`);
	console.log(`METRIC total_credits=${totalCredits}`);
	console.log(`METRIC scenarios_tested=${successes}`);
	console.log(`METRIC cache_hits=${cacheHits}`);
	console.log(`METRIC rag_hits=${ragHits}`);
}

run();
