import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { cleanObject, firecrawlRequest, jsonResult, withStatus } from "./client.js";
import { store as storeContent } from "./rag-pipeline-client.js";

export const FIRECRAWL_TOOL_NAMES = [
	"firecrawl_scrape",
	"firecrawl_crawl",
	"firecrawl_crawl_status",
	"firecrawl_map",
	"firecrawl_search",
	"firecrawl_parse",
	"firecrawl_interact",
	"firecrawl_monitor_create",
	"firecrawl_monitor_list",
	"firecrawl_monitor_checks",
	"firecrawl_optimize",
] as const;
export type FirecrawlToolName = (typeof FIRECRAWL_TOOL_NAMES)[number];

const StringArray = Type.Array(Type.String());

export const scrapeTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[0],
	label: "Firecrawl: Scrape",
	description: "Scrape a single URL through Firecrawl and return requested formats.",
	promptSnippet: "Scrape a URL through Firecrawl",
	promptGuidelines: [
		"Use firecrawl_scrape when you need clean markdown, HTML, links, screenshots, or structured extraction for one URL.",
		"If FIRECRAWL_API_KEY is missing, report the configuration error instead of retrying repeatedly.",
	],
	parameters: Type.Object({
		url: Type.String({ description: "URL to scrape." }),
		formats: Type.Optional(
			Type.Array(
				Type.String({
					description:
						"Requested Firecrawl output format, such as markdown, html, rawHtml, links, screenshot, or json.",
				}),
				{ description: "Firecrawl output formats. Defaults to Firecrawl's API default." },
			),
		),
		onlyMainContent: Type.Optional(
			Type.Boolean({ description: "Return only the main page content when supported." }),
		),
		includeTags: Type.Optional(StringArray),
		excludeTags: Type.Optional(StringArray),
		waitFor: Type.Optional(Type.Number({ description: "Milliseconds to wait before scraping." })),
		timeout: Type.Optional(
			Type.Number({ description: "Firecrawl request timeout in milliseconds." }),
		),
		mobile: Type.Optional(Type.Boolean({ description: "Use a mobile user agent when supported." })),
		skipTlsVerification: Type.Optional(
			Type.Boolean({ description: "Skip TLS certificate verification when supported." }),
		),
		removeBase64Images: Type.Optional(
			Type.Boolean({ description: "Remove base64 image data from the response when supported." }),
		),
		blockAds: Type.Optional(
			Type.Boolean({ description: "Block ads while scraping when supported." }),
		),
		headers: Type.Optional(
			Type.Record(Type.String(), Type.String(), {
				description: "Additional HTTP headers Firecrawl should use while fetching the target URL.",
			}),
		),
		jsonOptions: Type.Optional(
			Type.Any({ description: "Firecrawl jsonOptions for structured extraction." }),
		),
		actions: Type.Optional(
			Type.Array(Type.Any(), {
				description: "Firecrawl browser actions to perform before scraping.",
			}),
		),
		location: Type.Optional(Type.Any({ description: "Firecrawl location options." })),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "scrape", async () => {
		const payload = await firecrawlRequest("POST", "/scrape", cleanObject(params), signal);
		storeContent(params.url, JSON.stringify(payload));
		return jsonResult(payload);
		});
	},
});

export const crawlTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[1],
	label: "Firecrawl: Crawl",
	description: "Start a Firecrawl crawl job for a website.",
	promptSnippet: "Start a Firecrawl site crawl job",
	parameters: Type.Object({
		url: Type.String({ description: "Starting URL for the crawl." }),
		limit: Type.Optional(Type.Number({ description: "Maximum number of pages to crawl." })),
		maxDepth: Type.Optional(Type.Number({ description: "Maximum crawl depth when supported." })),
		includePaths: Type.Optional(
			Type.Array(Type.String(), { description: "URL path patterns to include." }),
		),
		excludePaths: Type.Optional(
			Type.Array(Type.String(), { description: "URL path patterns to exclude." }),
		),
		allowBackwardLinks: Type.Optional(
			Type.Boolean({ description: "Allow crawling backward links when supported." }),
		),
		allowExternalLinks: Type.Optional(
			Type.Boolean({ description: "Allow crawling external links when supported." }),
		),
		ignoreSitemap: Type.Optional(Type.Boolean({ description: "Ignore sitemap discovery." })),
		deduplicateSimilarURLs: Type.Optional(
			Type.Boolean({ description: "Deduplicate similar URLs when supported." }),
		),
		scrapeOptions: Type.Optional(
			Type.Any({ description: "Firecrawl scrapeOptions applied to crawled pages." }),
		),
		webhook: Type.Optional(Type.Any({ description: "Firecrawl webhook configuration." })),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "crawl", async () => {
		const payload = await firecrawlRequest("POST", "/crawl", cleanObject(params), signal);
		storeContent(params.url, JSON.stringify(payload));
		return jsonResult(payload);
		});
	},
});

export const crawlStatusTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[2],
	label: "Firecrawl: Crawl Status",
	description: "Check a Firecrawl crawl job status and retrieve completed crawl data.",
	promptSnippet: "Check a Firecrawl crawl job status",
	parameters: Type.Object({
		id: Type.String({ description: "Crawl job id returned by firecrawl_crawl." }),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "crawl status", async () => {
			const payload = await firecrawlRequest(
				"GET",
				`/crawl/${encodeURIComponent(params.id)}`,
				undefined,
				signal,
			);
			return jsonResult(payload);
		});
	},
});

export const mapTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[3],
	label: "Firecrawl: Map",
	description: "Discover URLs for a site through Firecrawl's map endpoint.",
	promptSnippet: "Map/discover URLs for a site through Firecrawl",
	parameters: Type.Object({
		url: Type.String({ description: "Website URL to map." }),
		search: Type.Optional(
			Type.String({ description: "Optional search term to filter discovered URLs." }),
		),
		ignoreSitemap: Type.Optional(Type.Boolean({ description: "Ignore sitemap discovery." })),
		sitemapOnly: Type.Optional(
			Type.Boolean({ description: "Only use sitemap URLs when supported." }),
		),
		includeSubdomains: Type.Optional(
			Type.Boolean({ description: "Include subdomains when supported." }),
		),
		limit: Type.Optional(Type.Number({ description: "Maximum number of URLs to return." })),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "map", async () => {
			const payload = await firecrawlRequest("POST", "/map", cleanObject(params), signal);
			return jsonResult(payload);
		});
	},
});

export const searchTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[4],
	label: "Firecrawl: Search",
	description: "Search the web through Firecrawl and optionally scrape search results.",
	promptSnippet: "Search the web through Firecrawl",
	parameters: Type.Object({
		query: Type.String({ description: "Search query." }),
		limit: Type.Optional(Type.Number({ description: "Maximum number of search results." })),
		tbs: Type.Optional(
			Type.String({ description: "Google-style time based search filter when supported." }),
		),
		location: Type.Optional(Type.String({ description: "Search location when supported." })),
		scrapeOptions: Type.Optional(
			Type.Any({ description: "Firecrawl scrapeOptions for search result pages." }),
		),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "search", async () => {
		const payload = await firecrawlRequest("POST", "/search", cleanObject(params), signal);
		storeContent(params.query, JSON.stringify(payload));
		return jsonResult(payload);
		});
	},
});

// ─── New Tools ───────────────────────────────────────────────────────────────

export const parseTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[5],
	label: "Firecrawl: Parse",
	description:
		"Upload a local file (PDF, DOCX, XLSX, HTML) and parse it into clean markdown or structured JSON.",
	promptSnippet: "Parse uploaded files via Firecrawl",
	promptGuidelines: [
		"Use firecrawl_parse when you need to convert a local file into markdown or structured data.",
		"Supports PDF, DOCX, XLSX, HTML, and other document formats.",
		"Provide the file as a base64-encoded string in the 'file' parameter.",
	],
	parameters: Type.Object({
		file: Type.String({
			description:
				"Base64-encoded file content. The file will be parsed by Firecrawl's Rust-based engine.",
		}),
		fileName: Type.Optional(
			Type.String({ description: "Original filename with extension (e.g. report.pdf)." }),
		),
		formats: Type.Optional(
			Type.Array(
				Type.String({
					description:
						"Requested output formats: markdown, html, rawHtml, links, screenshot, or json.",
				}),
				{ description: "Output formats. Defaults to Firecrawl's API default." },
			),
		),
		onlyMainContent: Type.Optional(
			Type.Boolean({ description: "Return only the main content excluding headers, navs, footers." }),
		),
		includeTags: Type.Optional(StringArray),
		excludeTags: Type.Optional(StringArray),
		timeout: Type.Optional(
			Type.Number({ description: "Timeout in milliseconds. Default 30000, max 300000." }),
		),
		parsers: Type.Optional(
			Type.Array(
				Type.Any({
					description:
						'Controls parser behavior. Example: [{ "type": "pdf", "mode": "auto", "maxPages": 100 }]',
				}),
			),
		),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "parse", async () => {
			const { file, fileName, ...options } = params;

			const binaryData = Buffer.from(file, "base64");
			const formData = new FormData();
			const blob = new Blob([binaryData]);
			formData.append("file", blob, fileName ?? "uploaded-file");

			if (Object.keys(cleanObject(options)).length > 0) {
				formData.append("options", JSON.stringify(cleanObject(options)));
			}

			const payload = await firecrawlRequest(
				"POST",
				"/parse",
				{ _multipart: formData } as unknown,
				signal,
			);
			return jsonResult(payload);
		});
	},
});

export const interactTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[6],
	label: "Firecrawl: Interact",
	description:
		"Create a Firecrawl browser session for interactive web tasks. Returns a CDP URL for browser control and live view URLs.",
	promptSnippet: "Create a Firecrawl browser interact session",
	promptGuidelines: [
		"Use firecrawl_interact when you need to create a browser session for interactive web tasks like login flows, form submissions, or multi-step navigation.",
		"The returned cdpUrl can be used with Chrome DevTools Protocol for full browser control.",
		"Use profile to persist browser state across sessions.",
	],
	parameters: Type.Object({
		ttl: Type.Optional(
			Type.Number({
				description: "Total session lifetime in seconds. Default 600, range 30-3600.",
			}),
		),
		activityTtl: Type.Optional(
			Type.Number({
				description: "Seconds of inactivity before session is destroyed. Default 300, range 10-3600.",
			}),
		),
		profile: Type.Optional(
			Type.Object(
				{
					name: Type.String({
						description: "Name for the profile (1-128 chars). Sessions with the same name share storage.",
					}),
					saveChanges: Type.Optional(
						Type.Boolean({
							description:
								"When true, browser state is saved back to the profile on close. Default true.",
						}),
					),
				},
				{
					description:
						"Enable persistent storage across sessions. Data saved in one session can be loaded in a later session using the same name.",
				},
			),
		),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "interact", async () => {
			const payload = await firecrawlRequest(
				"POST",
				"/interact",
				cleanObject(params),
				signal,
			);
			return jsonResult(payload);
		});
	},
});
export const monitorCreateTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[7],
	label: "Firecrawl: Monitor Create",
	description:
		"Create a recurring monitor that watches pages for changes and notifies via webhook or email.",
	promptSnippet: "Create a Firecrawl page monitor",
	promptGuidelines: [
		"Use firecrawl_monitor_create when the user wants to be notified when a page changes.",
		"Supports scrape targets (specific URLs), crawl targets (whole site), and search targets (web-wide queries).",
		"Set a goal in plain language to judge whether changes are meaningful.",
	],
	parameters: Type.Object({
		name: Type.String({ description: "Name for this monitor.", maxLength: 256 }),
		schedule: Type.Object({
			cron: Type.Optional(
				Type.String({ description: "Five-field cron expression. Min interval 5 minutes." }),
			),
			text: Type.Optional(
				Type.String({
					description:
						'Natural language schedule, e.g. "every 30 minutes", "daily at 9am", "weekly".',
				}),
			),
			timezone: Type.Optional(
				Type.String({ description: "IANA timezone. Default UTC.", default: "UTC" }),
			),
		}),
		targets: Type.Array(Type.Any(), {
			description:
				'Array of targets. Scrape: { type: "scrape", urls: [...] }. Crawl: { type: "crawl", url: "..." }. Search: { type: "search", queries: [...] }.',
			minItems: 1,
			maxItems: 50,
		}),
		goal: Type.Optional(
			Type.String({
				description:
					"Plain-language goal to judge whether changed pages are meaningful. Required for search targets.",
				maxLength: 2000,
			}),
		),
		webhook: Type.Optional(
			Type.Object({
				url: Type.String({ description: "Webhook URL to send events to." }),
				events: Type.Optional(
					Type.Array(Type.String(), {
						description: 'Events to receive: "monitor.page", "monitor.check.completed".',
					}),
				),
			}),
		),
		notification: Type.Optional(
			Type.Object({
				email: Type.Object({
					enabled: Type.Boolean({ default: false }),
					recipients: Type.Array(Type.String(), { maxItems: 25 }),
					includeDiffs: Type.Optional(Type.Boolean({ default: false })),
				}),
			}),
		),
		retentionDays: Type.Optional(
			Type.Number({ description: "Days to retain check data. 1-365, default 30.", minimum: 1, maximum: 365 }),
		),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "monitor create", async () => {
			const payload = await firecrawlRequest("POST", "/monitor", cleanObject(params), signal);
			return jsonResult(payload);
		});
	},
});

export const monitorListTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[8],
	label: "Firecrawl: Monitor List",
	description: "List all configured Firecrawl monitors.",
	promptSnippet: "List Firecrawl monitors",
	parameters: Type.Object({
		limit: Type.Optional(
			Type.Number({ description: "Max monitors to return. 1-100, default 25.", minimum: 1, maximum: 100 }),
		),
		offset: Type.Optional(
			Type.Number({ description: "Offset for pagination. Default 0.", minimum: 0 }),
		),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "monitor list", async () => {
			const query = new URLSearchParams();
			if (params.limit) query.set("limit", String(params.limit));
			if (params.offset) query.set("offset", String(params.offset));
			const qs = query.toString();
			const path = `/monitor${qs ? `?${qs}` : ""}`;
			const payload = await firecrawlRequest("GET", path, undefined, signal);
			return jsonResult(payload);
		});
	},
});

export const monitorChecksTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[9],
	label: "Firecrawl: Monitor Checks",
	description: "Get check results for a specific Firecrawl monitor.",
	promptSnippet: "Get Firecrawl monitor check results",
	parameters: Type.Object({
		id: Type.String({ description: "Monitor ID (UUID)." }),
		limit: Type.Optional(
			Type.Number({ description: "Max checks to return. 1-100, default 25.", minimum: 1, maximum: 100 }),
		),
		offset: Type.Optional(
			Type.Number({ description: "Offset for pagination. Default 0.", minimum: 0 }),
		),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "monitor checks", async () => {
			const query = new URLSearchParams();
			if (params.limit) query.set("limit", String(params.limit));
			if (params.offset) query.set("offset", String(params.offset));
			const qs = query.toString();
			const path = `/monitor/${encodeURIComponent(params.id)}/checks${qs ? `?${qs}` : ""}`;
			const payload = await firecrawlRequest("GET", path, undefined, signal);
			return jsonResult(payload);
		});
	},
});
export const optimizeTool = defineTool({
	name: FIRECRAWL_TOOL_NAMES[10],
	label: "Firecrawl: Optimize",
	description:
		"Cost-optimized Firecrawl wrapper. Estimates credit cost, checks URL cache, and recommends the cheapest tool path for a goal.",
	promptSnippet: "Optimize Firecrawl usage for cost efficiency",
	promptGuidelines: [
		"Use firecrawl_optimize BEFORE making any Firecrawl call to estimate cost and find cheaper alternatives.",
		"It checks the local URL cache to skip re-fetches and suggests the cheapest tool for the goal.",
	],
	parameters: Type.Object({
		goal: Type.String({
			description:
				"Describe what you want to achieve. The optimizer will recommend the cheapest path.",
		}),
		url: Type.Optional(
			Type.String({ description: "Specific URL to check cache status for." }),
		),
		action: Type.Optional(
			Type.String({
				description:
					'"estimate" (default) - estimate cost and suggest tool. "cache-check" - check if URL is cached. "budget" - show credit usage. "stats" - show cache statistics.',
				enum: ["estimate", "cache-check", "budget", "stats"],
			}),
		),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		return withStatus(ctx, "optimize", async () => {
			const { selectCheapestTool, estimateCost, shouldScrape, getBudgetStatus, getCacheStats } = await import("./optimizer.js");

			const action = (params.action as string) ?? "estimate";

			if (action === "budget") {
				const budget = getBudgetStatus();
				return jsonResult({
					...budget,
					message: budget.monthlyBudget > 0
						? `Used ${budget.totalUsed}/${budget.monthlyBudget} credits (${budget.percentage}%)`
						: "No budget set. Use setMonthlyBudget() to configure.",
				});
			}

			if (action === "stats") {
				const stats = getCacheStats();
				return jsonResult({
					...stats,
					message: `Cached ${stats.totalUrls} URLs, saved ${stats.totalCreditsSaved} credits`,
				});
			}

			if (action === "cache-check" && params.url) {
				const result = await shouldScrape(params.url as string);
				return jsonResult({
					url: params.url,
					...result,
					message: result.skip
						? `SKIP: ${result.reason}`
						: `FETCH: ${result.reason}`,
				});
			}

			// Default: estimate cost and suggest tool
			const recommendation = selectCheapestTool(params.goal as string);
			const cost = estimateCost(recommendation.tool.replace("firecrawl_", ""), params.url ? { url: params.url } : {});

			// Check URL cache if provided
			let cacheStatus = null;
			if (params.url) {
				const cached = await shouldScrape(params.url as string);
				cacheStatus = cached;
			}

			return jsonResult({
				goal: params.goal,
				recommendedTool: recommendation.tool,
				reason: recommendation.reason,
				estimatedCredits: cost.estimatedCredits,
				costBreakdown: cost.reason,
				cheaperAlternative: cost.cheaperAlternative,
				alternativeSavings: cost.alternativeSavings,
				cacheStatus,
				tip: cost.cheaperAlternative
					? `Consider using ${cost.cheaperAlternative} instead to save ${cost.alternativeSavings} credits.`
					: "This is already the cheapest option.",
			});
		});
	},
});
