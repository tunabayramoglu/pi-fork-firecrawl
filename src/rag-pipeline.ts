/**
 * RAG Pipeline Orchestrator
 * Wires together: Optimizer → RAG Check → Firecrawl API → RAG Store
 *
 * Flow:
 * 1. Agent wants content → call RAG pipeline
 * 2. Pipeline checks RAG cache (top-3 results)
 * 3. If sufficient → return cached content (0 credits)
 * 4. If insufficient → call Firecrawl API (1 credit)
 * 5. After Firecrawl returns → store content in RAG
 */

import { query as ragQuery, store as ragStore, stats } from "./rag-pipeline-client.js";
import { isCacheSufficient } from "./optimizer.js";

// ─── Decision Logic ──────────────────────────────────────────────────────────

interface RAGResult {
	id: number;
	url: string;
	title: string;
	summary: string;
	content: string;
	score: number;
	domain: string;
	access_count: number;
}

interface PipelineResult {
	action: "cache_hit" | "scrape";
	content?: string;
	summary?: string;
	sources?: RAGResult[];
	credits: number;
	confidence: number;
}


/**
 * Synthesize content from multiple RAG results.
 */
function synthesizeContent(results: RAGResult[]): string {
	return results
		.map((r) => `## ${r.title}\n\n${r.content || r.summary}`)
		.join("\n\n---\n\n");
}

// ─── Pipeline API ────────────────────────────────────────────────────────────

/**
 * Main pipeline entry point.
 * Given a query, returns cached content or indicates scraping is needed.
 */
export async function queryWithCache(
	query: string,
	options: {
		topK?: number;
		threshold?: number;
	} = {},
): Promise<PipelineResult> {
	const { topK = 3, threshold = 0.3 } = options;

	// 1. Search RAG cache
	const ragResult = await ragQuery(query, topK, threshold);

	if (!ragResult.results || ragResult.results.length === 0) {
		return {
			action: "scrape",
			credits: 1,
			confidence: 0,
		};
	}

	// 2. Check if cached content is sufficient
	const sufficient = isCacheSufficient(ragResult.results, query);

	if (sufficient) {
		return {
			action: "cache_hit",
			content: synthesizeContent(ragResult.results),
			summary: ragResult.results[0]?.summary,
			sources: ragResult.results,
			credits: 0,
			confidence: ragResult.results[0]?.score ?? 0,
		};
	}

	// 3. Cache hit but insufficient — return context for targeted scrape
	return {
		action: "scrape",
		sources: ragResult.results,
		credits: 1,
		confidence: ragResult.results[0]?.score ?? 0,
	};
}

/**
 * Store scraped content in the RAG pipeline.
 */
export function storeContent(
	url: string,
	content: string,
	title?: string,
): boolean {
	return ragStore(url, content, title ?? url);
}

/**
 * Get pipeline statistics.
 */
export function getStats(): Record<string, unknown> {
	return stats();
}
