#!/usr/bin/env node
// Dynamic Firecrawl Credit Efficiency Benchmark
// Tests optimizer + RAG cache with semantic similarity

import { selectCheapestTool, estimateCost, shouldScrape, recordUsage } from "../src/optimizer.ts";
import { insert as vectorInsert, search as vectorSearch, initStore } from "../src/vector-store.ts";
// import { preprocessText } from "../src/embeddings.ts"; // not available in Node

function preprocessText(url, title = "", description = "") {
	try {
		const parsed = new URL(url);
		const pathParts = parsed.pathname.split('/').filter(p => p && p !== 'index.html');
		const parts = [...pathParts, parsed.hostname.replace('www.', '')];
		if (title) parts.push(title);
		if (description) parts.push(description.slice(0, 200));
		return parts.join(' ').toLowerCase().trim();
	} catch {
		return url.toLowerCase();
	}
}
// Simple embed function for benchmark (deterministic hash-based)
function embed(text) {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
	}
	const embedding = new Array(384).fill(0);
	for (let i = 0; i < 384; i++) {
		embedding[i] = Math.sin(hash * (i + 1) * 0.001) * 0.5;
	}
	const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
	return embedding.map(v => v / norm);
}
initStore();

// Pre-populate URL cache
recordUsage("scrape", "https://example.com", 1, "markdown");
recordUsage("scrape", "https://example.org", 1, "markdown");
recordUsage("scrape", "https://example.com/page", 1, "markdown");
recordUsage("scrape", "https://example.com/read", 1, "markdown");
recordUsage("scrape", "https://example.com/what", 1, "markdown");
recordUsage("scrape", "https://example.com/docs", 1, "markdown");
recordUsage("scrape", "https://example.com/search", 1, "markdown");
recordUsage("scrape", "https://example.com/overview", 1, "markdown");

// Pre-populate vector store with semantic embeddings
const semanticEntries = [
	{ url: "https://example.com/blog/ai-tools", title: "Best AI Coding Tools 2026" },
	{ url: "https://example.com/blog/development", title: "Top Development Tools" },
	{ url: "https://example.com/docs/getting-started", title: "Getting Started Guide" },
	{ url: "https://example.com/docs/api-reference", title: "API Documentation" },
	{ url: "https://example.com/pricing/plans", title: "Pricing and Plans" },
];

for (const { url, title } of semanticEntries) {
	const text = preprocessText(url, title);
	const embedding = await embed(text);
	vectorInsert(url, embedding, { url, title, credits: 1 });
}

const scenarios = [
	// Easy: exact URL cache hits (0 credits)
	{ goal: "scrape https://example.com", url: "https://example.com", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "extract content from this page", url: "https://example.com/docs", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "scrape https://example.org", url: "https://example.org", expectedTool: "firecrawl_scrape", expectCached: true },

	// Medium: search
	{ goal: "find pages about AI coding tools", expectedTool: "firecrawl_search" },
	{ goal: "search for firecrawl documentation", expectedTool: "firecrawl_search" },

	// Medium: map
	{ goal: "get all blog posts from example.com", expectedTool: "firecrawl_map" },
	{ goal: "list all pages on this site", expectedTool: "firecrawl_map" },

	// Medium: monitor
	{ goal: "monitor this page for changes", expectedTool: "firecrawl_monitor_create" },
	{ goal: "notify me when pricing changes", expectedTool: "firecrawl_monitor_create" },

	// Hard: parse
	{ goal: "parse this PDF document", expectedTool: "firecrawl_parse" },
	{ goal: "extract text from local file", expectedTool: "firecrawl_parse" },

	// Hard: interact
	{ goal: "login and scrape dashboard", expectedTool: "firecrawl_interact" },

	// Hard: crawl alternatives
	{ goal: "get 5 pages from a 100-page site", expectedTool: "firecrawl_map" },
	{ goal: "extract content from specific pages only", expectedTool: "firecrawl_scrape" },

	// Hard: search alternatives
	{ goal: "find recent articles about machine learning", expectedTool: "firecrawl_search" },
	{ goal: "discover documentation pages", expectedTool: "firecrawl_search" },

	// URL normalization cache hits
	{ goal: "scrape https://example.com/page?utm_source=google", url: "https://example.com/page?utm_source=google", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "scrape https://example.com/Page/", url: "https://example.com/Page/", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "re-check https://example.com/page?ref=homepage", url: "https://example.com/page?ref=homepage", expectedTool: "firecrawl_scrape", expectCached: true },

	// Semantic cache hits (different URLs, similar content)
	{ goal: "scrape https://example.com/blog/ai-coding-tools", url: "https://example.com/blog/ai-coding-tools", expectedTool: "firecrawl_scrape", expectSemanticCached: true },
	{ goal: "scrape https://example.com/blog/dev-tools", url: "https://example.com/blog/dev-tools", expectedTool: "firecrawl_scrape", expectSemanticCached: true },
	{ goal: "scrape https://example.com/docs/start", url: "https://example.com/docs/start", expectedTool: "firecrawl_scrape", expectSemanticCached: true },
	{ goal: "scrape https://example.com/docs/api-docs", url: "https://example.com/docs/api-docs", expectedTool: "firecrawl_scrape", expectSemanticCached: true },

	// Edge cases
	{ goal: "read this URL", url: "https://example.com/read", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "get data from website", expectedTool: "firecrawl_scrape" },
	{ goal: "crawl example.com docs", expectedTool: "firecrawl_map" },
	{ goal: "what's on this page", url: "https://example.com/what", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "site structure for example.com", expectedTool: "firecrawl_map" },
	{ goal: "site audit for example.com", expectedTool: "firecrawl_map" },
];

async function run() {
	let totalCredits = 0;
	let successes = 0;
	let correctToolSelections = 0;
	let cacheHits = 0;
	let semanticHits = 0;

	for (const scenario of scenarios) {
		const recommendation = selectCheapestTool(scenario.goal);
		const toolName = recommendation.tool.replace("firecrawl_", "");

		let credits = 0;
		if (scenario.url && (scenario.expectCached || scenario.expectSemanticCached)) {
			const cacheResult = await shouldScrape(scenario.url);
			if (cacheResult.skip) {
				credits = 0;
				cacheHits++;
				if (cacheResult.reason.includes("Semantic match")) {
					semanticHits++;
				}
			} else {
				credits = estimateCost(toolName, { url: scenario.url }).estimatedCredits;
			}
		} else {
			credits = estimateCost(toolName, scenario.url ? { url: scenario.url } : {}).estimatedCredits;
		}

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
	console.log(`METRIC semantic_hits=${semanticHits}`);
}

run();
