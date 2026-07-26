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

// ─── Stub Embedding Function ─────────────────────────────────────────────────
// TODO: Replace with actual ONNX Runtime inference
// For now, returns a deterministic pseudo-embedding based on text hash

/**
 * Generate embedding for text.
 * Currently a stub — returns a hash-based pseudo-vector.
 * Replace with actual model inference for production use.
 */
export async function embed(text: string): Promise<number[]> {
	// Check cache first
	const cached = getCachedEmbedding(text);
	if (cached) return cached;

	// Generate deterministic pseudo-embedding from text
	const embedding = generatePseudoEmbedding(text);
	setCachedEmbedding(text, embedding);

	return embedding;
}

/**
 * Generate a deterministic pseudo-embedding from text.
 * This is a placeholder — real implementation will use ONNX Runtime.
 */
function generatePseudoEmbedding(text: string): number[] {
	const embedding = new Array(DEFAULT_DIMENSION).fill(0);

	// Simple hash-based embedding
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i);
		hash = ((hash << 5) - hash + char) | 0;
		embedding[i % DEFAULT_DIMENSION] += hash / 1000;
	}

	// Normalize
	const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
	if (norm > 0) {
		for (let i = 0; i < embedding.length; i++) {
			embedding[i] /= norm;
		}
	}

	return embedding;
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
