/**
 * RAG Cache Client
 * Calls the Python RAG service for semantic similarity caching.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";

const PYTHON_SCRIPT = join(import.meta.dirname ?? ".", "..", "python", "rag_cache.py");

function runPython(command: string, ...args: string[]): unknown {
	try {
		const cmd = `python "${PYTHON_SCRIPT}" ${command} ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`;
		const output = execSync(cmd, {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return JSON.parse(output.trim());
	} catch {
		return null;
	}
}

/**
 * Get embedding for text via Python service.
 */
export function embed(text: string): number[] | null {
	const result = runPython("embed", text) as { embedding?: number[] } | null;
	return result?.embedding ?? null;
}

/**
 * Search for similar entries via Python service.
 */
export function search(
	queryText: string,
	topK = 5,
	threshold = 0.85,
): { url: string; score: number; metadata: Record<string, unknown> }[] {
	const result = runPython("search", queryText, String(topK)) as {
		results?: { url: string; score: number; metadata: Record<string, unknown> }[];
	} | null;
	return result?.results ?? [];
}

/**
 * Insert entry into cache via Python service.
 */
export function insert(
	url: string,
	text: string,
	metadata: Record<string, unknown> = {},
): boolean {
	const result = runPython("insert", url, text, JSON.stringify(metadata)) as {
		success?: boolean;
	} | null;
	return result?.success ?? false;
}

/**
 * Get cache statistics.
 */
export function stats(): {
	total_entries: number;
	cache_file: string;
	model: string;
	embedding_dim: number;
} | null {
	return runPython("stats") as {
		total_entries: number;
		cache_file: string;
		model: string;
		embedding_dim: number;
	} | null;
}

/**
 * Initialize the RAG cache (download model).
 */
export function init(): boolean {
	const result = runPython("init") as string | null;
	return result !== null;
}
