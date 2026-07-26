import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { addApiKey, hasApiKey, loadConfig, saveConfig } from "./client.js";
import { loadSettings } from "./settings.js";
import {
	allFirecrawlTools,
	applyFirecrawlTools,
	buildCommandGuide,
	buildConfigMessage,
	buildStatusMessage,
	clearSettingsNotice,
	recordSettingsNotice,
	showToolSelector,
	updateFirecrawlTools,
} from "./tool-selector.js";
import { crawlStatusTool, crawlTool, interactTool, mapTool, monitorChecksTool, monitorCreateTool, monitorListTool, optimizeTool, parseTool, scrapeTool, searchTool } from "./tools.js";

const STATUS_KEY = "firecrawl";
const COMMAND_COMPLETIONS = [
	{ value: "help", label: "help", description: "Show command usage" },
	{ value: "config", label: "config", description: "Show configuration quick start" },
	{ value: "quickstart", label: "quickstart", description: "Show configuration quick start" },
	{ value: "status", label: "status", description: "Show tool and settings status" },
	{ value: "tools", label: "tools", description: "Select Firecrawl tools" },
	{ value: "toggle", label: "toggle", description: "Select Firecrawl tools" },
	{ value: "enable", label: "enable", description: "Enable all Firecrawl tools" },
	{ value: "disable", label: "disable", description: "Disable all Firecrawl tools" },
	{ value: "add-api", label: "add-api <key>", description: "Add a Firecrawl API key" },
	{ value: "remove-api", label: "remove-api <name>", description: "Remove a Firecrawl API key" },
	{ value: "list-api", label: "list-api", description: "List all configured API keys" },
];
const MENU_OPTIONS = {
	config: "Configuration quick start",
	help: "Command usage guide",
	status: "Show tool status",
	tools: "Select Firecrawl tools",
	enable: "Enable all Firecrawl tools",
	disable: "Disable all Firecrawl tools",
	"add-api": "Add a Firecrawl API key",
	"remove-api": "Remove a Firecrawl API key",
	"list-api": "List all configured API keys",
} as const;
type CommandAction =
	| "menu"
	| "help"
	| "config"
	| "quickstart"
	| "status"
	| "tools"
	| "enable"
	| "disable"
	| "add-api"
	| "remove-api"
	| "list-api";
type CommandContext = ExtensionCommandContext;
export default function firecrawl(pi: ExtensionAPI) {
	pi.registerTool(scrapeTool);
	pi.registerTool(crawlTool);
	pi.registerTool(crawlStatusTool);
	pi.registerTool(mapTool);
	pi.registerTool(searchTool);
	pi.registerTool(parseTool);
	pi.registerTool(interactTool);
	pi.registerTool(monitorCreateTool);
	pi.registerTool(monitorListTool);
	pi.registerTool(monitorChecksTool);
	pi.registerTool(optimizeTool);

	pi.registerCommand("firecrawl", {
		description: "Open Firecrawl help and tool controls",
		getArgumentCompletions: (prefix) => commandCompletions(prefix),
		handler: async (args, ctx) => {
			await handleFirecrawlCommand(pi, args, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		clearSettingsNotice();
		ctx.ui.setStatus(STATUS_KEY, undefined);
		const settings = await loadSettings();
		recordSettingsNotice(settings);
		if (settings.notice) ctx.ui.notify(settings.notice, "warning");
		if (settings.kind === "loaded") {
			applyFirecrawlTools(pi, settings.settings.tools);
			return;
		}
		if (settings.kind === "invalid") {
			ctx.ui.notify(`Firecrawl settings ignored: ${settings.reason}`, "warning");
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}

async function handleFirecrawlCommand(pi: ExtensionAPI, args: string, ctx: CommandContext) {
	const command = parseCommand(args);
	switch (command) {
		case "menu":
			await showMenu(pi, ctx);
			return;
		case "help":
			ctx.ui.notify(buildCommandGuide(), "info");
			return;
		case "config":
		case "quickstart":
			ctx.ui.notify(buildConfigMessage(), hasApiKey() ? "info" : "warning");
			return;
		case "status":
			ctx.ui.notify(await buildStatusMessage(pi), hasApiKey() ? "info" : "warning");
			return;
		case "tools":
			await showToolSelector(pi, ctx);
			return;
		case "enable":
			await updateFirecrawlTools(pi, ctx, allFirecrawlTools(), "enabled all");
			return;
	case "disable":
		await updateFirecrawlTools(pi, ctx, [], "disabled all");
		return;
	case "add-api": {
		const key = args.trim().split(/\s+/).slice(1).join(" ").trim();
		if (!key) {
			ctx.ui.notify("Usage: /firecrawl add-api <your-api-key>", "warning");
			return;
		}
		ctx.ui.notify("Checking quota...", "info");
		const result = await addApiKey(key);
		if (result.success) {
			ctx.ui.notify(
				`API key added as "${result.name}"\n` +
					`Remaining credits: ${result.remainingCredits ?? "unknown"}\n` +
					`Plan credits: ${result.planCredits ?? "unknown"}`,
				"info",
			);
		} else {
			ctx.ui.notify(`Failed to add API key: ${result.error}`, "error");
		}
		return;
	}
	case "remove-api": {
		const name = args.trim().split(/\s+/).slice(1).join(" ").trim();
		if (!name) {
			ctx.ui.notify("Usage: /firecrawl remove-api <key-name>", "warning");
			return;
		}
		const cfg = loadConfig();
		const keys = cfg.keys ?? [];
		const idx = keys.findIndex((k) => k.name === name);
		if (idx === -1) {
			ctx.ui.notify(`Key "${name}" not found. Use /firecrawl list-api to see all keys.`, "warning");
			return;
		}
		keys.splice(idx, 1);
		cfg.keys = keys;
		saveConfig(cfg);
		ctx.ui.notify(`Key "${name}" removed.`, "info");
		return;
	}
	case "list-api": {
		const cfg = loadConfig();
		const keys = cfg.keys ?? [];
		if (keys.length === 0) {
			ctx.ui.notify("No API keys configured.\n\nUse: /firecrawl add-api <your-key>", "info");
			return;
		}
		const lines = keys.map(
			(k) => `${k.name}: ${k.key.slice(0, 8)}...${k.key.slice(-4)} (priority: ${k.priority}, quota: ${k.monthlyQuota ?? "auto"})`,
		);
		ctx.ui.notify(`Configured API keys (${keys.length}):\n${lines.join("\n")}`, "info");
		return;
	}
}

	ctx.ui.notify(`Unknown /firecrawl command: ${args.trim()}\n\n${buildCommandGuide()}`, "warning");
}

async function showMenu(pi: ExtensionAPI, ctx: CommandContext) {
	if (!ctx.hasUI) {
		ctx.ui.notify(
			`${buildCommandGuide()}\n\n${await buildStatusMessage(pi)}`,
			hasApiKey() ? "info" : "warning",
		);
		return;
	}

	const choice = await ctx.ui.select("Firecrawl", Object.values(MENU_OPTIONS));
	switch (choice) {
		case MENU_OPTIONS.config:
			ctx.ui.notify(buildConfigMessage(), hasApiKey() ? "info" : "warning");
			return;
		case MENU_OPTIONS.help:
			ctx.ui.notify(buildCommandGuide(), "info");
			return;
		case MENU_OPTIONS.status:
			ctx.ui.notify(await buildStatusMessage(pi), hasApiKey() ? "info" : "warning");
			return;
		case MENU_OPTIONS.tools:
			await showToolSelector(pi, ctx);
			return;
		case MENU_OPTIONS.enable:
			await updateFirecrawlTools(pi, ctx, allFirecrawlTools(), "enabled all");
			return;
	case MENU_OPTIONS.disable:
		await updateFirecrawlTools(pi, ctx, [], "disabled all");
		return;
	case MENU_OPTIONS["add-api"]: {
		const key = await ctx.ui.input("Firecrawl API Key", "fc-...");
		if (!key) return;
		ctx.ui.notify("Checking quota...", "info");
		const result = await addApiKey(key);
		if (result.success) {
			ctx.ui.notify(
				`API key added as "${result.name}"\n` +
					`Remaining credits: ${result.remainingCredits ?? "unknown"}\n` +
					`Plan credits: ${result.planCredits ?? "unknown"}`,
				"info",
			);
		} else {
			ctx.ui.notify(`Failed to add API key: ${result.error}`, "error");
		}
		return;
	}
	case MENU_OPTIONS["remove-api"]: {
		const cfg = loadConfig();
		const keys = cfg.keys ?? [];
		if (keys.length === 0) {
			ctx.ui.notify("No API keys configured.", "info");
			return;
		}
		const names = keys.map((k) => `${k.name}: ${k.key.slice(0, 8)}...${k.key.slice(-4)}`);
		const choice = await ctx.ui.select("Remove API key", names);
		if (!choice) return;
		const name = choice.split(":")[0].trim();
		const idx = keys.findIndex((k) => k.name === name);
		if (idx !== -1) {
			keys.splice(idx, 1);
			cfg.keys = keys;
			saveConfig(cfg);
			ctx.ui.notify(`Key "${name}" removed.`, "info");
		}
		return;
	}
	case MENU_OPTIONS["list-api"]: {
		const cfg = loadConfig();
		const keys = cfg.keys ?? [];
		if (keys.length === 0) {
			ctx.ui.notify("No API keys configured.\n\nUse: /firecrawl add-api <your-key>", "info");
			return;
		}
		const lines = keys.map(
			(k) => `${k.name}: ${k.key.slice(0, 8)}...${k.key.slice(-4)} (priority: ${k.priority}, quota: ${k.monthlyQuota ?? "auto"})`,
		);
		ctx.ui.notify(`Configured API keys (${keys.length}):\n${lines.join("\n")}`, "info");
		return;
	}
}
}

export function parseCommand(args: string): CommandAction | "unknown" {
	const trimmed = args.trim();
	const command = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
	if (!command) return "menu";
	if (command === "help") return "help";
	if (command === "config") return "config";
	if (command === "quickstart") return "quickstart";
	if (command === "status") return "status";
	if (command === "tools" || command === "select" || command === "toggle") return "tools";
	if (command === "enable" || command === "on") return "enable";
	if (command === "disable" || command === "off") return "disable";
	if (command === "add-api") return "add-api";
	if (command === "remove-api") return "remove-api";
	if (command === "list-api") return "list-api";
	return "unknown";
}

export function commandCompletions(prefix: string) {
	const normalized = prefix.trimStart().toLowerCase();
	if (/\s/.test(normalized)) return null;

	const matches = COMMAND_COMPLETIONS.filter((completion) =>
		completion.value.startsWith(normalized),
	);
	return matches.length > 0 ? matches : null;
}

export {
	cleanObject,
	formatPayload,
	jsonResult,
	normalizeApiUrl,
	parseResponseBody,
	loadConfig,
	saveConfig,
} from "./client.js";
export { installSettingsFileExclusively, normalizeFirecrawlSettings } from "./settings.js";
export { formatPersistedSelection, orderedFirecrawlTools } from "./tool-selector.js";
