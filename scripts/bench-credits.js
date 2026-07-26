#!/usr/bin/env node
// Dynamic Firecrawl Credit Efficiency Benchmark
// Tests actual optimizer tool selection and estimates real credit usage

import { selectCheapestTool, estimateCost, shouldScrape, recordUsage } from "../src/optimizer.ts";

// Pre-populate cache
recordUsage("scrape", "https://example.com", 1, "markdown");
recordUsage("scrape", "https://example.org", 1, "markdown");
recordUsage("scrape", "https://example.com/page", 1, "markdown");
recordUsage("scrape", "https://example.com/read", 1, "markdown");
recordUsage("scrape", "https://example.com/what", 1, "markdown");

const scenarios = [
	// Easy: single page
	{ goal: "scrape https://example.com", url: "https://example.com", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "extract content from this page", url: "https://example.com/docs", expectedTool: "firecrawl_scrape" },
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

	// Easy: more cache hits
	{ goal: "scrape https://example.com", url: "https://example.com", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "re-check https://example.org", url: "https://example.org", expectedTool: "firecrawl_scrape", expectCached: true },

	// Hard: URL normalization
	{ goal: "scrape https://example.com/page?utm_source=google", url: "https://example.com/page?utm_source=google", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "scrape https://example.com/Page/", url: "https://example.com/Page/", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "re-check https://example.com/page?ref=homepage", url: "https://example.com/page?ref=homepage", expectedTool: "firecrawl_scrape", expectCached: true },

	// Edge cases (some cached)
	{ goal: "read this URL", url: "https://example.com/read", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "get data from website", expectedTool: "firecrawl_scrape" },
	{ goal: "crawl example.com docs", expectedTool: "firecrawl_map" },
	{ goal: "what's on this page", url: "https://example.com/what", expectedTool: "firecrawl_scrape", expectCached: true },
	{ goal: "site audit for example.com", expectedTool: "firecrawl_map" },
];

let totalCredits = 0;
let successes = 0;
let correctToolSelections = 0;

for (const scenario of scenarios) {
	const recommendation = selectCheapestTool(scenario.goal);
	const toolName = recommendation.tool.replace("firecrawl_", "");

	let credits = 0;
	if (scenario.url && scenario.expectCached) {
		const cacheResult = shouldScrape(scenario.url);
		if (cacheResult.skip) {
			credits = 0;
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
