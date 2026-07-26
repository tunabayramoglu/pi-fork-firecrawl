/**
 * Vector Store for RAG Cache
 * Uses sqlite-vss for persistent vector search.
// import { cosineSimilarity } from "./embeddings.js"; // resolved at runtime by harness
*/

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}
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

/**
 * Initialize the vector store.
 * Tries sqlite-vss first, falls back to in-memory.
 */
export function initStore(): void {
	if (!useMemoryStore) return;

	try {
		// Try to load sqlite-vss
		const Database = require("better-sqlite3");
		const sqlite_vss = require("sqlite-vss");

		db = new Database(":memory:");
		sqlite_vss.load(db);

		// Create tables
		db.exec(`
			CREATE TABLE IF NOT EXISTS cache (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				url TEXT NOT NULL UNIQUE,
				embedding BLOB NOT NULL,
				metadata TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			CREATE VIRTUAL TABLE IF NOT EXISTS vss_index USING vss0(
				embedding(384)
			);
		`);

		useMemoryStore = false;
		console.log("Vector store: using sqlite-vss");
	} catch {
		console.log("Vector store: using in-memory (sqlite-vss not available)");
		useMemoryStore = true;
	}
}

/**
 * Insert a vector with metadata.
 */
export function insert(
	id: string,
	embedding: number[],
	metadata: Record<string, unknown>,
): void {
	if (!useMemoryStore && db) {
		const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
		const metadataJson = JSON.stringify(metadata);

		try {
			db.prepare(
				"INSERT OR REPLACE INTO cache (url, embedding, metadata, created_at) VALUES (?, ?, ?, ?)",
			).run(id, embeddingBlob, metadataJson, new Date().toISOString());

			db.prepare("INSERT INTO vss_index (embedding) VALUES (?)").run(embeddingBlob);
		} catch {
			// Fall back to memory
			memoryStore.set(id, {
				id,
				embedding,
				metadata,
				timestamp: new Date().toISOString(),
			});
		}
	} else {
		memoryStore.set(id, {
			id,
			embedding,
			metadata,
			timestamp: new Date().toISOString(),
		});
	}
}

/**
 * Search for similar vectors using cosine similarity.
 */
export function search(
	queryEmbedding: number[],
	topK = 5,
	threshold = 0.85,
): SimilarityResult[] {
	if (!useMemoryStore && db) {
		try {
			const queryBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
			const results = db
				.prepare(
					`SELECT c.url, c.metadata, v.distance
					FROM vss_index v
					JOIN cache c ON c.id = v.rowid
					WHERE vss_search(v.embedding, ?)
					ORDER BY v.distance
					LIMIT ?`,
				)
				.all(queryBlob, topK)
				.filter((row: any) => row.distance <= 1 - threshold)
				.map((row: any) => ({
					id: row.url,
					score: 1 - row.distance,
					metadata: JSON.parse(row.metadata),
				}));

			return results;
		} catch {
			// Fall back to memory search
		}
	}

	// In-memory search
	const results: SimilarityResult[] = [];
	for (const [id, entry] of memoryStore) {
		const score = cosineSimilarity(queryEmbedding, entry.embedding);
		if (score >= threshold) {
			results.push({
				id,
				score,
				metadata: entry.metadata,
			});
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, topK);
}

/**
 * Get entry by ID.
 */
export function get(id: string): VectorEntry | undefined {
	if (!useMemoryStore && db) {
		const row = db.prepare("SELECT * FROM cache WHERE url = ?").get(id);
		if (row) {
			return {
				id: row.url,
				embedding: Array.from(new Float32Array(row.embedding.buffer)),
				metadata: JSON.parse(row.metadata),
				timestamp: row.created_at,
			};
		}
		return undefined;
	}
	return memoryStore.get(id);
}

/**
 * Delete entry by ID.
 */
export function remove(id: string): boolean {
	if (!useMemoryStore && db) {
		try {
			db.prepare("DELETE FROM cache WHERE url = ?").run(id);
			return true;
		} catch {
			return false;
		}
	}
	return memoryStore.delete(id);
}

/**
 * Get store size.
 */
export function size(): number {
	if (!useMemoryStore && db) {
		return db.prepare("SELECT COUNT(*) as count FROM cache").get().count;
	}
	return memoryStore.size;
}

/**
 * Clear all entries.
 */
export function clear(): void {
	if (!useMemoryStore && db) {
		db.exec("DELETE FROM cache");
		db.exec("DELETE FROM vss_index");
	} else {
		memoryStore.clear();
	}
}

/**
 * Get all entries (for debugging).
 */
export function all(): VectorEntry[] {
	if (!useMemoryStore && db) {
		return db
			.prepare("SELECT * FROM cache")
			.all()
			.map((row: any) => ({
				id: row.url,
				embedding: Array.from(new Float32Array(row.embedding.buffer)),
				metadata: JSON.parse(row.metadata),
				timestamp: row.created_at,
			}));
	}
	return Array.from(memoryStore.values());
}

/**
 * Check if using sqlite-vss.
 */
export function isUsingSqliteVss(): boolean {
	return !useMemoryStore;
}
