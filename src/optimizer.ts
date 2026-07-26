import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_FILE = "firecrawl-cache.json";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry {
	url: string;
	tool: string;
	format: string;
	timestamp: string;
	credits: number;
}

interface CacheStore {
	scraped: Record<string, CacheEntry>; // keyed by URL
	totalCreditsUsed: number;
	monthlyBudget: number;
	updatedAt: string;
}

interface CostEstimate {
	tool: string;
	estimatedCredits: number;
	reason: string;
	cheaperAlternative?: string;
	alternativeSavings?: number;
}

// ─── Cost Table ──────────────────────────────────────────────────────────────

const COSTS: Record<string, number> = {
	scrape: 1,
	crawl: 1,
	map: 1,
	search: 0.2, // 2 credits / 10 results
	parse: 1,
	interact: 2,
	monitor_create: 1, // per page per check
	monitor_list: 0,
	monitor_checks: 0,
	crawl_status: 0,
};

const JSON_SURCHARGE = 4;
const ENHANCED_SURCHARGE = 4;

// ─── Cache Management ────────────────────────────────────────────────────────

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function loadCache(): CacheStore {
	try {
		const raw = readFileSync(join(agentDir(), CACHE_FILE), "utf8");
		return JSON.parse(raw) as CacheStore;
	} catch {
		return { scraped: {}, totalCreditsUsed: 0, monthlyBudget: 0, updatedAt: new Date().toISOString() };
	}
}

function saveCache(store: CacheStore): void {
	store.updatedAt = new Date().toISOString();
	try {
		const dir = agentDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(join(agentDir(), CACHE_FILE), JSON.stringify(store, null, 2), "utf8");
	} catch {
		// best effort
	}
}

// ─── URL Normalization ──────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const trackingParams = [
			"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
			"fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source", "spm",
		];
		for (const param of trackingParams) {
			parsed.searchParams.delete(param);
		}
		let pathname = parsed.pathname.replace(/\/+$/, "") || "/";
		pathname = pathname.toLowerCase();
		return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
	} catch {
		return url.toLowerCase().replace(/\/+$/, "");
	}
}

// ─── URL Deduplication ───────────────────────────────────────────────────────

export async function shouldScrape(url: string, format = "markdown", title?: string): Promise<{ skip: boolean; reason: string }> {
	const store = loadCache();
	const normalized = normalizeUrl(url);

	// 1. Check exact match
	const entry = store.scraped[url] ?? store.scraped[normalized];
	if (entry) {
		const age = Date.now() - new Date(entry.timestamp).getTime();
		if (age > CACHE_TTL) {
			return { skip: false, reason: "Cache expired" };
		}
		if (entry.format !== format) {
			return { skip: false, reason: `Different format requested (cached: ${entry.format}, requested: ${format})` };
		}
		return { skip: true, reason: `Already scraped ${entry.tool} at ${entry.timestamp} (${entry.credits} credits saved)` };
	}

	// 2. Semantic similarity check (RAG cache via Python service)
	try {
		const { search: ragSearch } = await import("./rag-client.js");
		const queryText = preprocessText(url, title);
		const results = ragSearch(queryText, 1, 0.85);

		if (results.length > 0 && results[0].score > 0.85) {
			const matched = results[0];
			return {
				skip: true,
				reason: `Semantic match: ${matched.url} (similarity: ${matched.score.toFixed(2)}) — ${matched.metadata.credits ?? 0} credits saved`,
			};
		}
	} catch {
		// RAG service not available — fall through to URL-only cache
	}

	return { skip: false, reason: "URL not cached" };
}

export async function recordUsage(tool: string, url: string, credits: number, format = "markdown", title?: string): Promise<void> {
	const store = loadCache();
	const normalized = normalizeUrl(url);
	const entry = { url, tool, format, timestamp: new Date().toISOString(), credits };
	store.scraped[url] = entry;
	if (normalized !== url) {
		store.scraped[normalized] = entry;
	}
	store.totalCreditsUsed += credits;
	saveCache(store);

	// Store embedding for semantic similarity search (via Python RAG service)
	try {
		const { insert: ragInsert } = await import("./rag-client.js");
		const text = preprocessText(url, title);
		ragInsert(url, text, { url, tool, credits, format, title });
	} catch {
		// RAG service not available — skip
	}
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────

export function estimateCost(tool: string, params: Record<string, unknown>): CostEstimate {
	const baseCost = COSTS[tool] ?? 1;

	switch (tool) {
		case "scrape": {
			const formats = (params.formats as string[]) ?? ["markdown"];
			let cost = baseCost;
			const extras: string[] = [];
			if (formats.includes("json")) { cost += JSON_SURCHARGE; extras.push("+4 JSON"); }
			if (formats.includes("screenshot")) { cost += 1; extras.push("+1 screenshot"); }
			return {
				tool,
				estimatedCredits: cost,
				reason: extras.length ? `${baseCost} base + ${extras.join(", ")}` : `${cost} credit(s)`,
				cheaperAlternative: "map + scrape",
				alternativeSavings: Math.max(0, cost - 2),
			};
		}

		case "crawl": {
			const limit = (params.limit as number) ?? 100;
			const cost = limit * baseCost;
			return {
				tool,
				estimatedCredits: cost,
				reason: `${limit} pages x ${baseCost} credit(s) = ${cost} credits`,
				cheaperAlternative: "map + selective scrape",
				alternativeSavings: Math.max(0, cost - Math.ceil(limit * 0.2) - 1),
			};
		}

		case "search": {
			const limit = (params.limit as number) ?? 10;
			const cost = Math.ceil(limit / 10) * 2;
			const willScrape = params.scrapeOptions !== undefined;
			const scrapeCost = willScrape ? limit : 0;
			const total = cost + scrapeCost;
			return {
				tool,
				estimatedCredits: total,
				reason: willScrape
					? `${cost} search + ${scrapeCost} scrape = ${total} credits`
					: `${cost} credits (no scraping)`,
				cheaperAlternative: willScrape ? "search without scrapeOptions" : undefined,
				alternativeSavings: willScrape ? scrapeCost : 0,
			};
		}

		case "map": {
			return {
				tool,
				estimatedCredits: 1,
				reason: "1 credit for URL discovery",
			};
		}

	case "interact": {
		const ttl = (params.ttl as number) ?? 60; // default 1 min, not 5
		const minutes = Math.ceil(ttl / 60);
		const cost = minutes * baseCost;
		return {
			tool,
			estimatedCredits: cost,
			reason: `${minutes} min x ${baseCost} credits/min = ${cost} credits`,
			cheaperAlternative: "scrape with actions",
			alternativeSavings: Math.max(0, cost - 1),
		};
	}

		case "parse": {
			return {
				tool,
				estimatedCredits: baseCost,
				reason: "1 credit per page",
			};
		}

		default:
			return {
				tool,
				estimatedCredits: baseCost,
				reason: `${baseCost} credit(s)`,
			};
	}
}

// ─── Smart Tool Selection ────────────────────────────────────────────────────

export function selectCheapestTool(goal: string): {
	tool: string;
	params: Record<string, unknown>;
	reason: string;
} {
	const lower = goal.toLowerCase();

	// Discovery needed — use map
	if (lower.includes("all pages") || lower.includes("every page") || lower.includes("site map") || lower.includes("list all urls") || lower.includes("from a") || lower.includes("from this site") || lower.includes("selective") || lower.includes("specific pages") || (lower.includes("crawl") && lower.includes("docs")) || (lower.includes("crawl") && lower.includes("site")) || lower.includes("overview") || lower.includes("audit") || lower.includes("sitemap") || lower.includes("structure") || lower.includes("index")) {
		return {
			tool: "firecrawl_map",
			params: {},
			reason: "Map discovers all URLs for 1 credit. Scrape only what you need after.",
		};
	}

	// Search + selective scrape (suggest low result count)
	if (lower.includes("search") || lower.includes("find") || lower.includes("discover") || lower.includes("look for") || lower.includes("articles") || lower.includes("documentation") || lower.includes("recent")) {
		return {
			tool: "firecrawl_search",
			params: { limit: 3 },
			reason: "Search discovers relevant pages. Limit to 3 results to save credits (2 cr vs 6 cr for 10).",
		};
	}

	// Monitoring
	if (lower.includes("monitor") || lower.includes("watch") || lower.includes("notify") || lower.includes("alert") || lower.includes("track changes")) {
		return {
			tool: "firecrawl_monitor_create",
			params: {},
			reason: "Monitor checks automatically and only charges for actual changes.",
		};
	}

	// Local file
	if (lower.includes("pdf") || lower.includes("docx") || lower.includes("xlsx") || lower.includes("local file") || lower.includes("upload")) {
		return {
			tool: "firecrawl_parse",
			params: {},
			reason: "Parse handles local files directly.",
		};
	}

	// Needs interaction — check if scrape with actions suffices
	if (lower.includes("login") || lower.includes("sign in") || lower.includes("form") || lower.includes("click") || lower.includes("navigate")) {
		const needsFullBrowser = lower.includes("login") || lower.includes("sign in") || lower.includes("multi-step");
		return {
			tool: needsFullBrowser ? "firecrawl_interact" : "firecrawl_scrape",
			params: needsFullBrowser ? {} : { actions: [{ type: "wait", selector: "body" }] },
			reason: needsFullBrowser
				? "Full browser interaction needed (login, multi-step forms)."
				: "Scrape with actions may work (1 credit vs 2 credits/min). Try this first.",
		};
	}

	// Single known URL — use scrape
	if (lower.includes("scrape") || lower.includes("this url") || lower.includes("this page") || lower.includes("extract from")) {
		return {
			tool: "firecrawl_scrape",
			params: { formats: ["markdown"] },
			reason: "Scrape is the cheapest for single URLs. Markdown format (no JSON surcharge).",
		};
	}

	// Default: scrape with markdown
	return {
		tool: "firecrawl_scrape",
		params: { formats: ["markdown"] },
		reason: "Default: scrape with markdown format (1 credit, no surcharges).",
	};
}

// ─── Budget Tracking ─────────────────────────────────────────────────────────

export function getBudgetStatus(): {
	totalUsed: number;
	monthlyBudget: number;
	remaining: number;
	percentage: number;
} {
	const store = loadCache();
	const remaining = store.monthlyBudget - store.totalCreditsUsed;
	return {
		totalUsed: store.totalCreditsUsed,
		monthlyBudget: store.monthlyBudget,
		remaining: Math.max(0, remaining),
		percentage: store.monthlyBudget > 0 ? Math.round((store.totalCreditsUsed / store.monthlyBudget) * 100) : 0,
	};
}

export function setMonthlyBudget(budget: number): void {
	const store = loadCache();
	store.monthlyBudget = budget;
	saveCache(store);
}

export function resetMonthlyUsage(): void {
	const store = loadCache();
	store.totalCreditsUsed = 0;
	store.scraped = {};
	saveCache(store);
}

// ─── Cache Stats ─────────────────────────────────────────────────────────────

export function getCacheStats(): {
	totalUrls: number;
	totalCreditsSaved: number;
	oldestEntry: string | null;
	newestEntry: string | null;
} {
	const store = loadCache();
	const entries = Object.values(store.scraped);
	if (entries.length === 0) {
		return { totalUrls: 0, totalCreditsSaved: 0, oldestEntry: null, newestEntry: null };
	}

	const sorted = entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return {
		totalUrls: entries.length,
		totalCreditsSaved: entries.reduce((sum, e) => sum + e.credits, 0),
		oldestEntry: sorted[0].timestamp,
		newestEntry: sorted[sorted.length - 1].timestamp,
	};
}
