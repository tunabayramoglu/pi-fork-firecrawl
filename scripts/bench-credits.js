#!/usr/bin/env node
// Dynamic Firecrawl Credit Efficiency Benchmark
// Tests actual optimizer tool selection and estimates real credit usage

import { selectCheapestTool, estimateCost, shouldScrape } from "../src/optimizer.ts";

const scenarios = [
  // Easy: single page
  { goal: "scrape https://example.com", url: "https://example.com", expectedTool: "firecrawl_scrape" },
  { goal: "extract content from this page", url: "https://example.com/docs", expectedTool: "firecrawl_scrape" },

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

  // Hard: interact (should be avoided)
  { goal: "login and scrape dashboard", expectedTool: "firecrawl_interact" },
];

let totalCredits = 0;
let successes = 0;
let correctToolSelections = 0;

for (const scenario of scenarios) {
  const recommendation = selectCheapestTool(scenario.goal);
  const toolName = recommendation.tool.replace("firecrawl_", "");
  const cost = estimateCost(toolName, scenario.url ? { url: scenario.url } : {});

  totalCredits += cost.estimatedCredits;
  successes++;

  if (recommendation.tool === scenario.expectedTool) {
    correctToolSelections++;
  }
}

const creditsPerExtraction = (totalCredits / successes).toFixed(2);
const toolAccuracy = ((correctToolSelections / successes) * 100).toFixed(0);

// Emit metrics
console.log(`METRIC credits_per_extraction=${creditsPerExtraction}`);
console.log(`METRIC tool_selection_accuracy=${toolAccuracy}`);
console.log(`METRIC total_credits=${totalCredits}`);
console.log(`METRIC scenarios_tested=${successes}`);
