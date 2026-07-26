#!/usr/bin/env node
// Firecrawl RAG Cache Benchmark
// Tests credit savings over a sequence of related queries

import { execSync } from 'child_process';

const PYTHON = 'python';
const RAG_SCRIPT = 'python/rag_pipeline.py';
const CWD = 'C:/Users/Asus/Documents/_Projects/pi-firecrawl-multikey';

// ─── RAG Pipeline Interface ──────────────────────────────────────────────────

function ragQuery(queryText, topK = 3, threshold = 0.3) {
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

// Decision: is cached content sufficient?
function isCacheSufficient(results, query) {
	if (!results || results.length === 0) return false;
	const topScore = results[0]?.score ?? 0;
	const resultCount = results.length;
	const wordCount = query.split(' ').length;

	if (topScore >= 0.8) return true;
	if (resultCount >= 2 && results[1]?.score >= 0.5) return true;
	if (wordCount <= 6 && topScore >= 0.6) return true;

	return false;
}

// ─── Simulate a Real Agent Session ───────────────────────────────────────────

const session = [
	// Session 1: First query — must scrape (cache empty)
	{
		query: "How does firecrawl authentication work?",
		scrape_url: "https://firecrawl.dev/docs/auth",
		scrape_content: "Firecrawl authentication uses API keys. Create keys in the dashboard. Keys start with fc-. API key authentication with Bearer tokens. Rate limits apply per team.",
		scrape_title: "Authentication Guide",
		expected_credits: 1,  // must scrape
	},

	// Session 2: Related query — should hit cache
	{
		query: "What about API key security?",
		expected_credits: 0,  // should find auth docs in cache
	},

	// Session 3: Related query — should hit cache
	{
		query: "How to set up API keys?",
		expected_credits: 0,  // should find auth docs in cache
	},

	// Session 4: Different topic — must scrape
	{
		query: "What are the rate limits?",
		scrape_url: "https://firecrawl.dev/docs/rate-limits",
		scrape_content: "Firecrawl rate limits are per team. Free tier gets 1000 credits per month. Hobby gets 5000. Standard gets 100000. Rate limits reset monthly.",
		scrape_title: "Rate Limits",
		expected_credits: 1,
	},

	// Session 5: Related to rate limits — should hit cache
	{
		query: "How many credits do I get?",
		expected_credits: 0,
	},

	// Session 6: Related to rate limits — should hit cache
	{
		query: "What happens when I exceed limits?",
		expected_credits: 0,
	},

	// Session 7: New topic — must scrape
	{
		query: "How does crawling work?",
		scrape_url: "https://firecrawl.dev/docs/crawl",
		scrape_content: "Crawl endpoint starts a site crawl job. Returns a job id. Use crawl status to check progress. Supports limit, maxDepth, includePaths, excludePaths.",
		scrape_title: "Crawl Documentation",
		expected_credits: 1,
	},

	// Session 8: Related to crawl — should hit cache
	{
		query: "How to control crawl depth?",
		expected_credits: 0,
	},

	// Session 9: Related to crawl — should hit cache
	{
		query: "Crawl job status checking",
		expected_credits: 0,
	},

	// Session 10: New topic — must scrape
	{
		query: "How does pricing work?",
		scrape_url: "https://firecrawl.dev/docs/pricing",
		scrape_content: "Pricing: Free 1000 credits, Hobby $19/mo 5000 credits, Standard $99/mo 100000 credits, Growth $399/mo 500000 credits. Credits reset monthly.",
		scrape_title: "Pricing",
		expected_credits: 1,
	},

	// Session 11: Related to pricing — should hit cache
	{
		query: "What does the hobby plan include?",
		expected_credits: 0,
	},

	// Session 12: Related to pricing — should hit cache
	{
		query: "Enterprise pricing options",
		expected_credits: 0,
	},
];

// ─── Run Benchmark ───────────────────────────────────────────────────────────

console.log('Running RAG cache benchmark...\n');

let totalCredits = 0;
let cacheHits = 0;
let misses = 0;

for (let i = 0; i < session.length; i++) {
	const step = session[i];
	process.stdout.write(`Step ${i + 1}: "${step.query}" ... `);

	// Check RAG cache
	const ragResult = ragQuery(step.query, 3, 0.3);
	const sufficient = ragResult.results && ragResult.results.length > 0 && isCacheSufficient(ragResult.results, step.query);

	let credits = 0;
	if (sufficient) {
		// Cache hit — 0 credits
		credits = 0;
		cacheHits++;
		console.log(`CACHE HIT (${ragResult.results.length} results, score: ${ragResult.results[0]?.score?.toFixed(2)})`);
	} else if (step.scrape_url) {
		// Cache miss — scrape and store
		credits = 1;
		misses++;
		ragStore(step.scrape_url, step.scrape_content, step.scrape_title);
		console.log(`SCRAPE (stored: ${step.scrape_title})`);
	} else {
		// Cache miss but no scrape URL — would need to scrape
		credits = 1;
		misses++;
		console.log(`MISS (no cached content)`);
	}

	totalCredits += credits;
}

// ─── Results ─────────────────────────────────────────────────────────────────

console.log('\n--- Results ---');
console.log(`Total credits: ${totalCredits}`);
console.log(`Cache hits: ${cacheHits}/${session.length}`);
console.log(`Misses: ${misses}/${session.length}`);
console.log(`Credits per query: ${(totalCredits / session.length).toFixed(2)}`);
console.log(`Savings vs always-scrape: ${((1 - totalCredits / session.length) * 100).toFixed(0)}%`);

console.log(`\nMETRIC credits_per_extraction=${(totalCredits / session.length).toFixed(2)}`);
console.log(`METRIC cache_hit_rate=${(cacheHits / session.length).toFixed(2)}`);
console.log(`METRIC total_credits=${totalCredits}`);
console.log(`METRIC sessions=${session.length}`);
