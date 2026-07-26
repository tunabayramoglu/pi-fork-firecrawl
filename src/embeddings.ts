/**
 * Embedding module for RAG cache
 * Uses ONNX Runtime for local inference with bge-small-en-v1.5
 *
 * For now, this is a stub that will be replaced with actual model inference.
 * The architecture supports:
 * - ONNX Runtime for local inference
 * - OpenVINO for quantized models
 * - HTTP fallback to a remote embedding API
 */

export interface EmbeddingResult {
	embedding: number[];
	text: string;
}

export interface SimilarityResult {
	id: string;
	score: number;
	metadata: Record<string, unknown>;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_MODEL = "BAAI/bge-small-en-v1.5";
const DEFAULT_DIMENSION = 384;
const SIMILARITY_THRESHOLD = 0.85;

// ─── Text Preprocessing ──────────────────────────────────────────────────────

/**
 * Preprocess text for embedding.
 * Combines URL + title/description for better semantic matching.
 */
export function preprocessText(url: string, title?: string, description?: string): string {
	const parts: string[] = [];

	// Extract meaningful parts from URL
	try {
		const parsed = new URL(url);
		const pathParts = parsed.pathname
			.split("/")
			.filter((p) => p && p !== "index.html" && p !== "index.php");
		if (pathParts.length > 0) {
			parts.push(pathParts.join(" "));
		}
		if (parsed.hostname) {
			parts.push(parsed.hostname.replace("www.", ""));
		}
	} catch {
		parts.push(url);
	}

	if (title) parts.push(title);
	if (description) parts.push(description.slice(0, 200));

	return parts.join(" ").toLowerCase().trim();
}

// ─── Similarity Calculation ──────────────────────────────────────────────────

/**
 * Calculate cosine similarity between two vectors.
 * Used when vector DB is not available.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	return denominator === 0 ? 0 : dotProduct / denominator;
}

// ─── Embedding Cache ─────────────────────────────────────────────────────────

interface CachedEmbedding {
	text: string;
	embedding: number[];
	timestamp: string;
}

const embeddingCache = new Map<string, CachedEmbedding>();
const CACHE_MAX_SIZE = 1000;

export function getCachedEmbedding(text: string): number[] | null {
	const cached = embeddingCache.get(text);
	if (!cached) return null;

	const age = Date.now() - new Date(cached.timestamp).getTime();
	if (age > 24 * 60 * 60 * 1000) {
		embeddingCache.delete(text);
		return null;
	}

	return cached.embedding;
}

export function setCachedEmbedding(text: string, embedding: number[]): void {
	if (embeddingCache.size >= CACHE_MAX_SIZE) {
		// Remove oldest entry
		const oldestKey = embeddingCache.keys().next().value;
		if (oldestKey) embeddingCache.delete(oldestKey);
	}

	embeddingCache.set(text, {
		text,
		embedding,
		timestamp: new Date().toISOString(),
	});
}

// ─── Embedding Function ─────────────────────────────────────────────────────

/**
 * Generate embedding for text.
 * Requires a working embedding backend. Throws immediately if none is available,
 * rather than silently returning a meaningless hash-based pseudo-vector.
 *
 * Setup options (pick one):
 *   1. Install sentence-transformers:
 *        pip install sentence-transformers
 *      Then ensure the Python embedding server is running and
 *      EMBEDDING_BACKEND is set to "python".
 *
 *   2. Configure an OpenVINO model:
 *        Set EMBEDDING_BACKEND to "openvino" and point
 *        OPENVINO_MODEL_PATH to a valid IR directory.
 *
 * Without one of these the cache will not produce meaningful results.
 */
export async function embed(text: string): Promise<number[]> {
	// Check cache first
	const cached = getCachedEmbedding(text);
	if (cached) return cached;

	const backend = process.env.EMBEDDING_BACKEND;
	if (backend === "python") {
		// TODO: call sentence-transformers embedding server
		throw new Error(
			'Python embedding backend is selected but the embedding server is not implemented yet. ' +
			'Embeddings require a real model to produce meaningful vectors.'
		);
	}
	if (backend === "openvino") {
		// TODO: call OpenVINO inference
		throw new Error(
			'OpenVINO embedding backend is selected but inference is not implemented yet. ' +
			'Embeddings require a real model to produce meaningful vectors.'
		);
	}

	// No backend configured — fail loudly instead of returning fake embeddings
	throw new Error(
		'No embedding backend configured. RAG cache requires real embeddings to work correctly. ' +
		'Set EMBEDDING_BACKEND to "python" and install sentence-transformers, ' +
		'or set it to "openvino" and configure OPENVINO_MODEL_PATH. ' +
		'Example: pip install sentence-transformers'
	);
}

// ─── Batch Embedding ─────────────────────────────────────────────────────────

/**
 * Embed multiple texts in parallel.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
	return Promise.all(texts.map((text) => embed(text)));
}

// ─── Export Constants ────────────────────────────────────────────────────────

export const EMBEDDING_CONFIG = {
	model: DEFAULT_MODEL,
	dimension: DEFAULT_DIMENSION,
	similarityThreshold: SIMILARITY_THRESHOLD,
} as const;
