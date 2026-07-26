/**
 * RAG Pipeline Client
 * Calls the Python RAG pipeline for knowledge retrieval.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";

const PYTHON_SCRIPT = join(
	import.meta.dirname ?? ".",
	"..",
	"python",
	"rag_pipeline.py",
);

function runPython(command: string, ...args: string[]): unknown {
	try {
		const escapedArgs = args
			.map((a) => `"${a.replace(/"/g, '\\"')}"`)
			.join(" ");
		const cmd = `python "${PYTHON_SCRIPT}" ${command} ${escapedArgs}`;
		const output = execSync(cmd, {
			encoding: "utf-8",
			timeout: 10000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return JSON.parse(output.trim());
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[rag-pipeline] Python failed: ${msg}\n`);
		return null;
	}
}

// ─── Pipeline Interface ──────────────────────────────────────────────────────

/**
 * Store scraped content in the RAG cache.
 */
export function store(
	url: string,
	content: string,
	title = "",
	metadata: Record<string, unknown> = {},
): { success?: boolean; url?: string; summary?: string; error?: string } {
	const result = runPython("store", url, content, title, JSON.stringify(metadata));
	return (result as { success?: boolean; url?: string; summary?: string; error?: string }) ?? {
		error: "Pipeline not available",
	};
}

/**
 * Query the cache for similar content.
 */
export function query(
	queryText: string,
	topK = 5,
	threshold = 0.75,
): {
	results?: {
		id: number;
		url: string;
		title: string;
		summary: string;
		score: number;
		domain: string;
		access_count: number;
	}[];
	query?: string;
	error?: string;
} {
	const result = runPython("query", queryText, String(topK), String(threshold));
	return (typeof result === "object" && result !== null ? result : { error: "Pipeline not available" }) as {
		results?: {
			id: number;
			url: string;
			title: string;
			summary: string;
			score: number;
			domain: string;
			access_count: number;
		}[];
		query?: string;
		error?: string;
	};
}

/**
 * Get pipeline statistics.
 */
export function stats(): {
	total_entries?: number;
	unique_domains?: number;
	avg_access_count?: number;
	embedding_model?: string;
	embedding_dim?: number;
	similarity_threshold?: number;
	max_entries?: number;
	error?: string;
} {
	const result = runPython("stats");
	return (typeof result === "object" && result !== null
		? result
		: { error: "Pipeline not available" }) as {
		total_entries?: number;
		unique_domains?: number;
		avg_access_count?: number;
		embedding_model?: string;
		embedding_dim?: number;
		similarity_threshold?: number;
		max_entries?: number;
		error?: string;
	};
}

/**
 * Evict stale entries.
 */
export function evict(): { deleted?: number; cutoff?: string; error?: string } {
	const result = runPython("evict");
	return (typeof result === "object" && result !== null
		? result
		: { error: "Pipeline not available" }) as {
		deleted?: number;
		cutoff?: string;
		error?: string;
	};
}

/**
 * Initialize the pipeline.
 */
export function init(): boolean {
	const result = runPython("init");
	return result !== null;
}
