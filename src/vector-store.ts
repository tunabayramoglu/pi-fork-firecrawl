/**
 * Vector Store for RAG Cache
 * In-memory vector store with cosine similarity search.
 * For production, replace with sqlite-vss or FAISS.
 */

import { cosineSimilarity, type SimilarityResult } from "./embeddings.js";

interface VectorEntry {
	id: string;
	embedding: number[];
	metadata: Record<string, unknown>;
	timestamp: string;
}

// ─── In-Memory Store ─────────────────────────────────────────────────────────

const store = new Map<string, VectorEntry>();
let storeInitialized = false;

/**
 * Initialize the vector store.
 * In production, this would load from sqlite-vss or FAISS.
 */
export function initStore(): void {
	if (storeInitialized) return;
	// Load from disk if available
	storeInitialized = true;
}

/**
 * Insert a vector with metadata.
 */
export function insert(
	id: string,
	embedding: number[],
	metadata: Record<string, unknown>,
): void {
	store.set(id, {
		id,
		embedding,
		metadata,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Search for similar vectors using cosine similarity.
 * Returns results sorted by similarity (highest first).
 */
export function search(
	queryEmbedding: number[],
	topK = 5,
	threshold = 0.85,
): SimilarityResult[] {
	const results: SimilarityResult[] = [];

	for (const [id, entry] of store) {
		const score = cosineSimilarity(queryEmbedding, entry.embedding);
		if (score >= threshold) {
			results.push({
				id,
				score,
				metadata: entry.metadata,
			});
		}
	}

	// Sort by score descending
	results.sort((a, b) => b.score - a.score);

	return results.slice(0, topK);
}

/**
 * Get entry by ID.
 */
export function get(id: string): VectorEntry | undefined {
	return store.get(id);
}

/**
 * Delete entry by ID.
 */
export function remove(id: string): boolean {
	return store.delete(id);
}

/**
 * Get store size.
 */
export function size(): number {
	return store.size;
}

/**
 * Clear all entries.
 */
export function clear(): void {
	store.clear();
}

/**
 * Export store as JSON (for persistence).
 */
export function exportStore(): string {
	const entries = Array.from(store.values());
	return JSON.stringify(entries, null, 2);
}

/**
 * Import store from JSON.
 */
export function importStore(json: string): void {
	try {
		const entries = JSON.parse(json) as VectorEntry[];
		for (const entry of entries) {
			store.set(entry.id, entry);
		}
	} catch {
		// ignore invalid JSON
	}
}

/**
 * Get all entries (for debugging).
 */
export function all(): VectorEntry[] {
	return Array.from(store.values());
}
