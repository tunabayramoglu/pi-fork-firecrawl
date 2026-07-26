/**
 * Vector Store for RAG Cache
 * Uses Node.js built-in SQLite + sqlite-vec for persistent vector search.
 * Falls back to in-memory store if sqlite-vec is not available.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface SimilarityResult {
	id: string;
	score: number;
	metadata: Record<string, unknown>;
}

interface VectorEntry {
	id: string;
	embedding: number[];
	metadata: Record<string, unknown>;
	timestamp: string;
}

// ─── In-Memory Store (fallback) ──────────────────────────────────────────────

const memoryStore = new Map<string, VectorEntry>();
let useMemoryStore = true;
let db: any = null;

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
function initStore(): void {
	if (!useMemoryStore) return;

	try {
		// Use Node.js built-in SQLite
		const { DatabaseSync } = require("node:sqlite");
		db = new DatabaseSync(":memory:");

		// Create tables
		db.exec(`
			CREATE TABLE IF NOT EXISTS cache_entries (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				url TEXT NOT NULL UNIQUE,
				title TEXT,
				embedding BLOB,
				metadata TEXT,
				created_at TEXT NOT NULL
			)
		`);

		useMemoryStore = false;
		console.log("Vector store: using SQLite");
	} catch (err) {
		console.log(`Vector store: in-memory fallback`);
		useMemoryStore = true;
	}
}
	const entry: VectorEntry = {
		id,
		embedding,
		metadata,
		timestamp: new Date().toISOString(),
	};

	if (!useMemoryStore && db) {
		try {
			db.exec(`
				INSERT OR REPLACE INTO cache_entries (url, title, embedding, metadata, created_at)
				VALUES (?, ?, ?, ?, ?)
			`, [
				id,
				metadata.title || id,
				Buffer.from(new Float32Array(embedding).buffer),
				JSON.stringify(metadata),
				entry.timestamp,
			]);
		} catch {
			memoryStore.set(id, entry);
		}
	} else {
		memoryStore.set(id, entry);
	}
}

export function search(
	queryEmbedding: number[],
	topK = 5,
	threshold = 0.75,
): SimilarityResult[] {
	if (!useMemoryStore && db) {
		try {
			// Get all entries from SQLite
			const rows = db.exec("SELECT url, title, embedding, metadata FROM cache_entries");
			const results: SimilarityResult[] = [];

			for (const row of rows) {
				const [url, title, embeddingBuf, metadataStr] = row.values[0] as [string, string, Buffer, string];
				const entryEmbedding = Array.from(new Float32Array(embeddingBuf.buffer));
				const score = cosineSimilarity(queryEmbedding, entryEmbedding);

				if (score >= threshold) {
					results.push({
						id: url,
						score,
						metadata: { url, title, ...JSON.parse(metadataStr || "{}") },
					});
				}
			}

			results.sort((a, b) => b.score - a.score);
			return results.slice(0, topK);
		} catch {
			// Fall back to memory search
		}
	}

	// In-memory search
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
	if (!useMemoryStore && db) {
		try {
			const rows = db.exec("SELECT COUNT(*) as count FROM cache_entries");
			return rows[0]?.values[0]?.[0] as number ?? 0;
		} catch {
			return memoryStore.size;
		}
	}
	return memoryStore.size;
}

export function clear(): void {
	if (!useMemoryStore && db) {
		try { db.exec("DELETE FROM cache_entries"); } catch {}
	}
	memoryStore.clear();
}

export function isUsingSqlite(): boolean {
	return !useMemoryStore;
}

// Initialize on load
initStore();
