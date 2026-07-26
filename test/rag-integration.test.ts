import { createMockContext } from "./support.ts";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import test from "node:test";

// ─── Module mocking (must happen before source imports) ──────────────────────
// mock.module replaces the entire module; provide all exports the dep tree needs.

import cp from "node:child_process";
const execSyncMock = mock.fn(() => "{}");

mock.module("node:child_process", {
	exports: {
		execSync: execSyncMock,
		spawn: cp.spawn,
		exec: cp.exec,
		execFile: cp.execFile,
		execFileSync: cp.execFileSync,
		spawnSync: cp.spawnSync,
		fork: cp.fork,
		ChildProcess: cp.ChildProcess,
	},
});

// ─── Test 1: rag-pipeline-client store, query, stats ─────────────────────────

test("rag-pipeline-client store returns parsed JSON from Python subprocess", async () => {
	const { store } = await import("../src/rag-pipeline-client\.ts");

	execSyncMock.mock.mockImplementation(() =>
		JSON.stringify({ success: true, url: "https://example.com", summary: "Cached" }),
	);

	const result = store("https://example.com", "page content", "Test Title", { source: "test" });

	assert.deepEqual(result, { success: true, url: "https://example.com", summary: "Cached" });
	assert.ok(execSyncMock.mock.callCount() > 0, "execSync should have been called");

	const cmd = String(execSyncMock.mock.calls[0].arguments[0]);
	assert.match(cmd, /python/);
	assert.match(cmd, /store/);
	assert.match(cmd, /https:\/\/example\.com/);
});

test("rag-pipeline-client query returns parsed results from Python subprocess", async () => {
	const { query } = await import("../src/rag-pipeline-client\.ts");

	const mockResults = {
		results: [
			{
				id: 1,
				url: "https://example.com",
				title: "Example",
				summary: "A test page",
				score: 0.92,
				domain: "example.com",
				access_count: 5,
			},
		],
		query: "test search",
	};
	execSyncMock.mock.mockImplementation(() => JSON.stringify(mockResults));

	const result = query("test search", 3, 0.5);

	assert.deepEqual(result, mockResults);
	const lastIdx = execSyncMock.mock.callCount() - 1;
	const cmd = String(execSyncMock.mock.calls[lastIdx].arguments[0]);
	assert.match(cmd, /query/);
	assert.match(cmd, /test search/);
});

test("rag-pipeline-client stats returns parsed statistics", async () => {
	const { stats } = await import("../src/rag-pipeline-client\.ts");

	const mockStats = {
		total_entries: 42,
		unique_domains: 12,
		avg_access_count: 3.5,
		embedding_model: "bge-small-en-v1.5",
		embedding_dim: 384,
		similarity_threshold: 0.75,
		max_entries: 500,
	};
	execSyncMock.mock.mockImplementation(() => JSON.stringify(mockStats));

	const result = stats();

	assert.equal(result.total_entries, 42);
	assert.equal(result.unique_domains, 12);
	assert.equal(result.embedding_model, "bge-small-en-v1.5");
	assert.equal(result.max_entries, 500);
});

// ─── Test 2: optimizer isCacheSufficient (pure logic, no I/O) ────────────────

test("isCacheSufficient returns true for high score >= 0.8", async () => {
	const { isCacheSufficient } = await import("../src/optimizer\.ts");
	assert.equal(isCacheSufficient([{ score: 0.85 }], "test query"), true);
});

test("isCacheSufficient returns true when two results have decent scores", async () => {
	const { isCacheSufficient } = await import("../src/optimizer\.ts");
	const results = [
		{ score: 0.65 },
		{ score: 0.55 },
	];
	assert.equal(isCacheSufficient(results, "some longer query with many words"), true);
});

test("isCacheSufficient returns true for short query with moderate score", async () => {
	const { isCacheSufficient } = await import("../src/optimizer\.ts");
	assert.equal(isCacheSufficient([{ score: 0.62 }], "api documentation guide"), true);
});

test("isCacheSufficient returns false for low scores and long query", async () => {
	const { isCacheSufficient } = await import("../src/optimizer\.ts");
	const results = [
		{ score: 0.4 },
		{ score: 0.3 },
	];
	assert.equal(isCacheSufficient(results, "this is a very long query with many words"), false);
});

test("isCacheSufficient returns false for empty results", async () => {
	const { isCacheSufficient } = await import("../src/optimizer\.ts");
	assert.equal(isCacheSufficient([], "anything"), false);
});

// ─── Test 3: shouldScrape with RAG integration ──────────────────────────────

test("shouldScrape skips when RAG returns high-scoring results", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "rag-test-"));
	writeFileSync(
		join(agentDir, "firecrawl-cache.json"),
		JSON.stringify({ scraped: {}, budget: { totalUsed: 0, monthlyBudget: 0 } }),
	);

	const origAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {
		execSyncMock.mock.mockImplementation(() =>
			JSON.stringify({
				results: [
					{
						id: 1,
						url: "https://docs.example.com/api",
						title: "API Docs",
						summary: "Complete API reference",
						score: 0.85,
						domain: "docs.example.com",
						access_count: 10,
					},
				],
				query: "docs api reference",
			}),
		);

		const { shouldScrape } = await import("../src/optimizer\.ts");
		const result = await shouldScrape(
			"https://docs.example.com/api/guide",
			"markdown",
			"API Guide",
		);

		assert.equal(result.skip, true);
		assert.match(result.reason, /RAG cache hit/);
		assert.ok(result.content, "Should include content from RAG results");
	} finally {
		setOrDeleteEnv("PI_CODING_AGENT_DIR", origAgentDir);
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("shouldScrape returns skip=false when RAG has no relevant results", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "rag-test-"));
	writeFileSync(
		join(agentDir, "firecrawl-cache.json"),
		JSON.stringify({ scraped: {}, budget: { totalUsed: 0, monthlyBudget: 0 } }),
	);

	const origAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {
		execSyncMock.mock.mockImplementation(() =>
			JSON.stringify({ results: [], query: "nothing relevant" }),
		);

		const { shouldScrape } = await import("../src/optimizer\.ts");
		const result = await shouldScrape("https://brand-new-site.com/page", "markdown");

		assert.equal(result.skip, false);
		assert.match(result.reason, /No cached content found/);
	} finally {
		setOrDeleteEnv("PI_CODING_AGENT_DIR", origAgentDir);
		rmSync(agentDir, { recursive: true, force: true });
	}
});

// ─── Test 4: storeContent wiring in tools.ts ────────────────────────────────

test("scrapeTool calls storeContent after successful scrape", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "rag-tools-"));
	writeFileSync(
		join(agentDir, "pi-firecrawl-keys.json"),
		JSON.stringify({
			keys: [{ name: "test", key: "fc-test-key-123", priority: 1 }],
			strategy: "priority",
		}),
	);
	writeFileSync(
		join(agentDir, "firecrawl-cache.json"),
		JSON.stringify({ scraped: {}, budget: { totalUsed: 0, monthlyBudget: 0 } }),
	);

	const origAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;

	const prevFetch = globalThis.fetch;
	globalThis.fetch = mock.fn(async () =>
		new Response(JSON.stringify({ markdown: "# Hello", creditsUsed: 1 }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	) as typeof fetch;

	const callsBeforeScrape = execSyncMock.mock.callCount();
	execSyncMock.mock.mockImplementation(() => JSON.stringify({ success: true }));


	try {
		const { scrapeTool } = await import("../src/tools\.ts");

		const { ctx: mockCtx } = createMockContext();

		await scrapeTool.execute(
			"test-call",
			{ url: "https://example.com/page", formats: ["markdown"] },
			new AbortController().signal,
			mock.fn(),
			mockCtx as never,
		);

		// execSync was called by storeContent -> runPython -> execSync
		assert.ok(execSyncMock.mock.callCount() > callsBeforeScrape, "execSync should be called by storeContent");

		// The command should contain "store" (the rag-pipeline subcommand)
		const storeCalls = execSyncMock.mock.calls.slice(callsBeforeScrape).filter((c) =>
			String(c.arguments[0]).includes("store"),
		);
		assert.ok(storeCalls.length > 0, "storeContent should have invoked the 'store' command");
		assert.match(String(storeCalls[storeCalls.length - 1].arguments[0]), /https:\/\/example\.com\/page/);
	} finally {
		globalThis.fetch = prevFetch;
		setOrDeleteEnv("PI_CODING_AGENT_DIR", origAgentDir);
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("crawlTool calls storeContent with crawl URL", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "rag-crawl-"));
	writeFileSync(
		join(agentDir, "pi-firecrawl-keys.json"),
		JSON.stringify({
			keys: [{ name: "test", key: "fc-test-key-456", priority: 1 }],
			strategy: "priority",
		}),
	);
	writeFileSync(
		join(agentDir, "firecrawl-cache.json"),
		JSON.stringify({ scraped: {}, budget: { totalUsed: 0, monthlyBudget: 0 } }),
	);

	const origAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;

	const prevFetch = globalThis.fetch;
	globalThis.fetch = mock.fn(async () =>
		new Response(
			JSON.stringify({ id: "crawl-123", status: "completed", data: [{ url: "https://example.com" }] }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		),
	) as typeof fetch;

	execSyncMock.mock.mockImplementation(() => JSON.stringify({ success: true }));

	try {
		const { crawlTool } = await import("../src/tools\.ts");

		const { ctx: mockCtx } = createMockContext();

		await crawlTool.execute(
			"test-call",
			{ url: "https://example.com" },
			new AbortController().signal,
			mock.fn(),
			mockCtx as never,
		);

		const storeCall = execSyncMock.mock.calls.find((c) =>
			String(c.arguments[0]).includes("store"),
		);
		assert.ok(storeCall, "crawlTool should have called storeContent");
		assert.match(String(storeCall.arguments[0]), /https:\/\/example\.com/);
	} finally {
		globalThis.fetch = prevFetch;
		setOrDeleteEnv("PI_CODING_AGENT_DIR", origAgentDir);
		rmSync(agentDir, { recursive: true, force: true });
	}
});

// ─── Test 5: error handling ──────────────────────────────────────────────────

test("store returns error and logs stderr when Python subprocess fails", async () => {
	const { store } = await import("../src/rag-pipeline-client\.ts");

	const stderrChunks: string[] = [];
	const prevStderrWrite = process.stderr.write;
	process.stderr.write = mock.fn((chunk: string | Uint8Array) => {
		stderrChunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;

	try {
		execSyncMock.mock.mockImplementation(() => {
			throw new Error("Python subprocess exited with code 1");
		});

		const result = store("https://fail.com", "content");
		assert.deepEqual(result, { error: "Pipeline not available" });
		assert.ok(
			stderrChunks.some((msg) => msg.includes("Python failed")),
			"stderr should log the Python failure message",
		);
	} finally {
		process.stderr.write = prevStderrWrite;
	}
});

test("query returns error and logs stderr on failure", async () => {
	const { query } = await import("../src/rag-pipeline-client\.ts");

	const stderrChunks: string[] = [];
	const prevStderrWrite = process.stderr.write;
	process.stderr.write = mock.fn((chunk: string | Uint8Array) => {
		stderrChunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;

	try {
		execSyncMock.mock.mockImplementation(() => {
			throw new Error("Command failed: python exited 2");
		});

		const result = query("failing query");
		assert.equal(result.error, "Pipeline not available");
		assert.ok(
			stderrChunks.some((msg) => msg.includes("rag-pipeline")),
			"stderr should contain rag-pipeline prefix",
		);
	} finally {
		process.stderr.write = prevStderrWrite;
	}
});

test("stats returns error and logs stderr on failure", async () => {
	const { stats } = await import("../src/rag-pipeline-client\.ts");

	const stderrChunks: string[] = [];
	const prevStderrWrite = process.stderr.write;
	process.stderr.write = mock.fn((chunk: string | Uint8Array) => {
		stderrChunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;

	try {
		execSyncMock.mock.mockImplementation(() => {
			throw new Error("timeout exceeded");
		});

		const result = stats();
		assert.equal(result.error, "Pipeline not available");
		assert.ok(
			stderrChunks.some((msg) => msg.includes("timeout")),
			"stderr should mention the timeout error",
		);
	} finally {
		process.stderr.write = prevStderrWrite;
	}
});

test("store handles non-Error exceptions gracefully", async () => {
	const { store } = await import("../src/rag-pipeline-client\.ts");

	const stderrChunks: string[] = [];
	const prevStderrWrite = process.stderr.write;
	process.stderr.write = mock.fn((chunk: string | Uint8Array) => {
		stderrChunks.push(String(chunk));
		return true;
	}) as typeof process.stderr.write;

	try {
		// Simulate a non-Error throw
		execSyncMock.mock.mockImplementation(() => {
			throw "string error"; // eslint-disable-line no-throw-literal
		});

		const result = store("https://weird.com", "data");
		assert.deepEqual(result, { error: "Pipeline not available" });
		assert.ok(
			stderrChunks.some((msg) => msg.includes("string error")),
			"stderr should contain the stringified error",
		);
	} finally {
		process.stderr.write = prevStderrWrite;
	}
});

test("init returns false on failure and true on success", async () => {
	const { init } = await import("../src/rag-pipeline-client\.ts");

	execSyncMock.mock.mockImplementation(() => {
		throw new Error("init failed");
	});
	assert.equal(init(), false);

	execSyncMock.mock.mockImplementation(() => JSON.stringify({ status: "ok" }));
	assert.equal(init(), true);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setOrDeleteEnv(key: string, value: string | undefined) {
	if (value !== undefined) {
		process.env[key] = value;
	} else {
		delete process.env[key];
	}
}
