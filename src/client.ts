import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_API_URL = "https://api.firecrawl.dev/v1";
const V2_API_URL = "https://api.firecrawl.dev/v2";
const STATUS_KEY = "firecrawl";
const USAGE_FILE = "firecrawl-usage.json";
const CONFIG_FILE = "pi-firecrawl.json";

let apiUrl = normalizeApiUrl(process.env.FIRECRAWL_API_URL ?? process.env.FIRECRAWL_BASE_URL);

// ─── Multi-Key Manager ───────────────────────────────────────────────────────

interface KeyEntry {
	name: string;
	key: string;
	priority: number;
	monthlyQuota?: number;
	disabled?: boolean;
}

interface UsageRecord {
	key: string;
	usedCredits: number;
	lastChecked: string;
	remainingCredits?: number;
	planCredits?: number;
}

export interface FirecrawlConfig {
	tools?: string[];
	keys?: KeyEntry[];
	strategy?: "quota-first" | "priority" | "round-robin";
	localTracking?: boolean;
	autoDisableOnExhausted?: boolean;
	updatedAt?: number;
}

interface UsageStore {
	keys: Record<string, UsageRecord>;
	updatedAt: string;
}

let configCache: FirecrawlConfig | null = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 30_000;

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function loadConfig(): FirecrawlConfig {
	const now = Date.now();
	if (configCache && now - configCacheTime < CONFIG_CACHE_TTL) return configCache;

	try {
		const raw = readFileSync(join(agentDir(), CONFIG_FILE), "utf8");
		configCache = JSON.parse(raw) as FirecrawlConfig;
		configCacheTime = now;
		return configCache!;
	} catch {
		configCache = {};
		configCacheTime = now;
		return configCache!;
	}
}

function loadUsage(): UsageStore {
	try {
		const raw = readFileSync(join(agentDir(), USAGE_FILE), "utf8");
		return JSON.parse(raw) as UsageStore;
	} catch {
		return { keys: {}, updatedAt: new Date().toISOString() };
	}
}

function saveUsage(store: UsageStore): void {
	store.updatedAt = new Date().toISOString();
	try {
		const dir = agentDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(join(agentDir(), USAGE_FILE), JSON.stringify(store, null, 2), "utf8");
	} catch {
		// best effort
	}
}

/**
 * Build the list of available keys from config + env fallback.
 * Config keys take precedence; env key is appended as lowest-priority fallback.
 */
function buildKeyList(): KeyEntry[] {
	const config = loadConfig();
	const configKeys = (config.keys ?? []).filter((k) => !k.disabled && k.key);

	const envKey = process.env.FIRECRAWL_API_KEY?.trim() || undefined;
	if (envKey && !configKeys.some((k) => k.key === envKey)) {
		configKeys.push({
			name: "env-default",
			key: envKey,
			priority: 999,
		});
	}

	return configKeys;
}

/**
 * Sort keys by strategy. Returns a copy — does not mutate.
 */
function sortKeys(keys: KeyEntry[], strategy?: string): KeyEntry[] {
	const sorted = [...keys];
	switch (strategy ?? "quota-first") {
		case "quota-first": {
			const usage = loadUsage();
			sorted.sort((a, b) => {
				const aRec = usage.keys[a.key];
				const bRec = usage.keys[b.key];
				const aRem = aRec?.remainingCredits ?? a.monthlyQuota ?? Infinity;
				const bRem = bRec?.remainingCredits ?? b.monthlyQuota ?? Infinity;
				if (bRem !== aRem) return bRem - aRem;
				return a.priority - b.priority;
			});
			break;
		}
		case "priority":
			sorted.sort((a, b) => a.priority - b.priority);
			break;
		case "round-robin": {
			const usage = loadUsage();
			sorted.sort((a, b) => {
				const aTime = usage.keys[a.key]?.lastChecked ?? "";
				const bTime = usage.keys[b.key]?.lastChecked ?? "";
				return aTime.localeCompare(bTime);
			});
			break;
		}
	}
	return sorted;
}

// ─── Quota Checking ──────────────────────────────────────────────────────────

/**
 * Check remaining credits for a key via the Firecrawl Credit Usage API (v2).
 */
async function checkQuota(apiKey: string): Promise<{
	remainingCredits?: number;
	planCredits?: number;
	error?: string;
}> {
	try {
		const response = await fetch(`${V2_API_URL}/team/credit-usage`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			return { error: `HTTP ${response.status}` };
		}

		const data = (await response.json()) as Record<string, unknown>;
		return {
			remainingCredits: data.remainingCredits as number | undefined,
			planCredits: data.planCredits as number | undefined,
		};
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Refresh quota for all keys and update local usage store.
 * Called on startup and periodically.
 */
async function refreshAllQuotas(): Promise<void> {
	const keys = buildKeyList();
	if (keys.length === 0) return;

	const store = loadUsage();

	await Promise.allSettled(
		keys.map(async (entry) => {
			const result = await checkQuota(entry.key);
			if (!result.error) {
				store.keys[entry.key] = {
					key: entry.key,
					usedCredits: result.planCredits
						? result.planCredits - (result.remainingCredits ?? 0)
						: store.keys[entry.key]?.usedCredits ?? 0,
					remainingCredits: result.remainingCredits,
					planCredits: result.planCredits,
					lastChecked: new Date().toISOString(),
				};
			}
		}),
	);

	saveUsage(store);
}

// ─── Key Selection ───────────────────────────────────────────────────────────

let currentKeyIndex = 0;
let keyList: KeyEntry[] = [];
let lastKeyListRefresh = 0;
const KEY_LIST_TTL = 60_000;

function refreshKeyList(): void {
	const now = Date.now();
	if (now - lastKeyListRefresh < KEY_LIST_TTL && keyList.length > 0) return;
	keyList = sortKeys(buildKeyList(), loadConfig().strategy);
	lastKeyListRefresh = now;
	currentKeyIndex = Math.min(currentKeyIndex, Math.max(keyList.length - 1, 0));
}

/**
 * Get the current best available API key.
 * If quota checking shows a key is exhausted, skip to the next one.
 */
async function selectBestKey(): Promise<{ key: string; name: string } | null> {
	refreshKeyList();
	if (keyList.length === 0) return null;

	const config = loadConfig();
	const store = loadUsage();
	const autoDisable = config.autoDisableOnExhausted ?? true;

	for (let i = 0; i < keyList.length; i++) {
		const idx = (currentKeyIndex + i) % keyList.length;
		const entry = keyList[idx];

		const record = store.keys[entry.key];
		if (autoDisable && record?.remainingCredits !== undefined && record.remainingCredits <= 0) {
			continue;
		}

		if (entry.monthlyQuota && record && record.usedCredits >= entry.monthlyQuota) {
			continue;
		}

		currentKeyIndex = idx;
		return { key: entry.key, name: entry.name };
	}

	return null;
}

/**
 * Rotate to the next available key after a failure.
 */
function rotateToNextKey(): { key: string; name: string } | null {
	refreshKeyList();
	if (keyList.length <= 1) return null;

	currentKeyIndex = (currentKeyIndex + 1) % keyList.length;
	const entry = keyList[currentKeyIndex];
	return { key: entry.key, name: entry.name };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function configuredApiUrl() {
	return apiUrl;
}

export function resetConfiguredApiUrl() {
	apiUrl = normalizeApiUrl(process.env.FIRECRAWL_API_URL ?? process.env.FIRECRAWL_BASE_URL);
}

export async function firecrawlRequest(
	method: "GET" | "POST",
	path: string,
	body: unknown,
	signal?: AbortSignal,
) {
	const selected = await selectBestKey();
	if (!selected) {
		throw new Error(
			"All Firecrawl API keys are exhausted. Add more keys to pi-firecrawl.json or reset your quotas.",
		);
	}

	const apiKey = selected.key;

	const store = loadUsage();
	if (!store.keys[apiKey]) {
		store.keys[apiKey] = {
			key: apiKey,
			usedCredits: 0,
			lastChecked: new Date().toISOString(),
		};
	}
	store.keys[apiKey].lastChecked = new Date().toISOString();
	saveUsage(store);

	const response = await fetch(`${apiUrl}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal,
	});
	const responseText = await response.text();
	const payload = parseResponseBody(responseText);

	// Handle 429 — rotate to next key and retry once
	if (response.status === 429) {
		const rotated = rotateToNextKey();
		if (rotated) {
			const retryResponse = await fetch(`${apiUrl}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${rotated.key}`,
					...(body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal,
			});
			const retryText = await retryResponse.text();
			const retryPayload = parseResponseBody(retryText);

			const lower = responseText.toLowerCase();
			if (lower.includes("monthly usage limit") || lower.includes("quota exceeded")) {
				const exhausted = loadUsage();
				if (exhausted.keys[apiKey]) {
					exhausted.keys[apiKey].remainingCredits = 0;
				}
				saveUsage(exhausted);
			}

			if (!retryResponse.ok) {
				throw new Error(
					`Firecrawl ${method} ${path} failed after key rotation (${retryResponse.status}): ${formatPayload(retryPayload)}`,
				);
			}

			incrementUsage(rotated.key);
			return retryPayload;
		}

		throw new Error(
			`Firecrawl ${method} ${path} failed (429): ${formatPayload(payload)}\n` +
				`All keys exhausted. Response: ${responseText.slice(0, 200)}`,
		);
	}

	if (!response.ok) {
		throw new Error(
			`Firecrawl ${method} ${path} failed (${response.status}): ${formatPayload(payload)}`,
		);
	}

	incrementUsage(apiKey);
	return payload;
}

function incrementUsage(key: string): void {
	const store = loadUsage();
	if (store.keys[key]) {
		store.keys[key].usedCredits += 1;
		store.keys[key].lastChecked = new Date().toISOString();
	}
	saveUsage(store);
}

export function getApiKey(): string {
	const selected = keyList[currentKeyIndex];
	if (selected) return selected.key;

	const envKey = process.env.FIRECRAWL_API_KEY?.trim() || undefined;
	if (envKey) return envKey;

	throw new Error(
		"FIRECRAWL_API_KEY is not configured. Set it in your shell or add keys to pi-firecrawl.json, then retry once.",
	);
}

export function hasApiKey() {
	return buildKeyList().length > 0;
}

export function normalizeApiUrl(value: string | undefined) {
	return (value?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
}

export function parseResponseBody(responseText: string) {
	if (!responseText) return {};
	try {
		return JSON.parse(responseText) as unknown;
	} catch {
		return responseText;
	}
}

export function formatPayload(payload: unknown) {
	return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export function jsonResult(payload: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
		details: payload,
	};
}

export async function withStatus<T>(
	ctx: Pick<ExtensionContext, "ui">,
	status: string,
	callback: () => Promise<T>,
) {
	ctx.ui.setStatus(STATUS_KEY, status);
	try {
		return await callback();
	} finally {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}

export function cleanObject<T>(value: T): T {
	if (Array.isArray(value)) return value.map(cleanObject) as T;
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.map(([key, item]) => [key, cleanObject(item)]),
	) as T;
}

// ─── Startup: refresh quotas ─────────────────────────────────────────────────
refreshAllQuotas().catch(() => {});
