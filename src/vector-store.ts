/**
 * Vector Store for RAG Cache
 *
 * Primary store is an in-memory Map — sqlite-vec is not available on Windows.
 * All functions are synchronous and operate on the Map directly.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SimilarityResult {
	id: string;
	score: number;
	metadata: Record<string, unknown>;
}

export interface VectorEntry {
	id: string;
	embedding: number[];
	metadata: Record<string, unknown>;
	timestamp: string;
}

// ─── In-Memory Store ─────────────────────────────────────────────────────────

const memoryStore = new Map<string, VectorEntry>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;

	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	if (denominator === 0) return 0;

	return dot / denominator;
}

// ─── Store Operations ────────────────────────────────────────────────────────

export function insert(
	id: string,
	embedding: number[],
	metadata: Record<string, unknown>,
): void {
	const entry: VectorEntry = {
		id,
		embedding,
		metadata,
		timestamp: new Date().toISOString(),
	};

	memoryStore.set(id, entry);
}

export function search(
	queryEmbedding: number[],
	topK = 5,
	threshold = 0.75,
): SimilarityResult[] {
	const results: SimilarityResult[] = [];

	for (const [id, entry] of memoryStore) {
		const score = cosineSimilarity(queryEmbedding, entry.embedding);
		if (score >= threshold) {
			results.push({ id, score, metadata: entry.metadata });
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, topK);
}

export function get(id: string): VectorEntry | undefined {
	return memoryStore.get(id);
}

export function remove(id: string): boolean {
	return memoryStore.delete(id);
}

export function size(): number {
	return memoryStore.size;
}

export function clear(): void {
	memoryStore.clear();
}

export function isUsingSqlite(): boolean {
	return false;
}

// ─── Initialization ──────────────────────────────────────────────────────────

export function initStore(): void {
	// Intentionally a no-op: in-memory Map is always ready.
	// SQLite path removed — sqlite-vec is not available on Windows.
}

// Initialize on load
initStore();
