# pi-firecrawl-multikey

Fork of [`@narumitw/pi-firecrawl`](https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-firecrawl) with **multi-key rotation** and **quota-aware fallback** for multiple Firecrawl accounts.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## What this adds on top of the original

| Feature | Original | This fork |
|---|---|---|
| API keys | Single key via env var | Multiple keys from config + env fallback |
| Quota awareness | None (reacts to 429 only) | Proactive credit check via Firecrawl API on startup |
| Key rotation | None | Auto-rotate on 429, retry with next key |
| Usage tracking | None | Local persistence across restarts |
| Strategies | N/A | `quota-first`, `priority`, `round-robin` |
| Tools | scrape, crawl, crawl_status, map, search | + **agent**, **parse**, **interact** |

## Install

```bash
pi install npm:@tuna-bayramoglu/pi-firecrawl-multikey
```

Try without installing permanently:

```bash
FIRECRAWL_API_KEY=fc-... pi -e npm:@tuna-bayramoglu/pi-firecrawl-multikey
```

## Configuration

### Single key (env var)

```bash
export FIRECRAWL_API_KEY=fc-your-key
```

### Multi-key (config file)

Add a `keys` array to `~/.pi/agent/pi-firecrawl.json`:

```json
{
  "tools": [
    "firecrawl_scrape", "firecrawl_crawl", "firecrawl_crawl_status",
    "firecrawl_map", "firecrawl_search",
    "firecrawl_agent", "firecrawl_parse", "firecrawl_interact"
  ],
  "keys": [
    {
      "name": "primary",
      "key": "fc-your-first-key",
      "priority": 1,
      "monthlyQuota": 5000,
      "disabled": false
    },
    {
      "name": "backup",
      "key": "fc-your-second-key",
      "priority": 2,
      "monthlyQuota": 1000,
      "disabled": false
    }
  ],
  "strategy": "quota-first",
  "autoDisableOnExhausted": true
}
```

**Strategy options:**

- `quota-first` (default) -- select the key with the most remaining credits, then by priority.
- `priority` -- always select by lowest priority number first.
- `round-robin` -- rotate through keys oldest-first.

**How it works:**

1. On startup, quota-checks all keys via `GET https://api.firecrawl.dev/v2/team/credit-usage`.
2. Selects the key with the most remaining credits (or highest priority).
3. On 429 + quota error, marks the key exhausted and retries with the next available key.
4. Usage is tracked locally in `~/.pi/agent/firecrawl-usage.json` across restarts.
5. The `FIRECRAWL_API_KEY` env var is used as a lowest-priority fallback if no config keys are present.

### Optional endpoint override

```bash
export FIRECRAWL_API_URL=https://api.firecrawl.dev/v1
```

`FIRECRAWL_BASE_URL` is also accepted.

## Tools
| Tool | Cost | Notes |
|---|---|---|
| scrape | 1 credit/page | +4 for JSON extraction, +4 for enhanced mode |
| crawl | 1 credit/page | Same adders as scrape |
| crawl_status | 0 credits | Check job status |
| map | 1 credit/call | Per call |
| search | 2 credits/10 results | Scraping results adds scrape costs |
| agent | 5 free/day, then dynamic | Based on agent tokens consumed |
| parse | 1 credit/page | Per PDF page; base64 upload |
| interact | 2 credits/minute | Browser session time |


### firecrawl_scrape -- 1 credit/page

Scrape a single URL into markdown, HTML, raw HTML, links, screenshots, or JSON.

**Best for:** Reading a specific page you already know -- docs pages, API references, blog posts, single articles. Cheapest option when you just need one URL's content.

**Avoid when:** You need content from many pages (use crawl), don't know which URLs to target (use map or search), or need interactive login/form filling (use interact).

```json
{ "url": "https://example.com", "formats": ["markdown"] }
```

### firecrawl_crawl -- 1 credit/page

Start a site crawl job and return the Firecrawl job id.

**Best for:** Ingesting an entire documentation site, blog archive, or product catalog. Set `limit` and `maxDepth` to control scope. Works well for building a knowledge base from a website.

**Avoid when:** You only need 1-3 pages (use scrape), need to discover what pages exist first (use map), or the site requires login (use interact).

```json
{ "url": "https://example.com", "limit": 10, "scrapeOptions": { "formats": ["markdown"] } }
```

### firecrawl_crawl_status -- 0 credits

Check a crawl job status and retrieve completed crawl data.

**Best for:** Polling a crawl started with firecrawl_crawl. Crawl jobs run async -- use this to check progress and collect results when complete.

```json
{ "id": "crawl-job-id" }
```

### firecrawl_map -- 1 credit/call

Discover URLs for a site.

**Best for:** Mapping a site's structure before deciding what to scrape. Use it to find all product pages, all blog posts, or all API docs on a domain. Much faster than crawl for URL discovery.

**Avoid when:** You already know the exact URLs (use scrape), or you need the actual page content (use crawl or scrape after mapping).

```json
{ "url": "https://example.com", "limit": 20 }
```

### firecrawl_search -- 2 credits/10 results

Search the web through Firecrawl and optionally scrape result pages.

**Best for:** Finding pages about a topic when you don't know which site to look at. Good for competitor research, finding documentation, or discovering relevant articles. The `scrapeOptions` param lets you get full content of results in one call.

**Avoid when:** You already have the URL (use scrape), or you need to crawl an entire site systematically (use crawl).

```json
{ "query": "firecrawl documentation", "limit": 5 }
```

### firecrawl_agent -- 5 free/day, then dynamic

Autonomous AI-powered web data extraction. Provide a prompt and optional URLs; the agent navigates, scrapes, and extracts structured data.

**Best for:** Complex extraction tasks where a simple scrape isn't enough -- multi-page data collection, sites that require navigation/clicking, pulling structured data from messy pages, or when you need a specific JSON schema filled. The agent figures out how to get the data on its own.

**Avoid when:** You just need raw page content (use scrape -- it's 50x cheaper), the page is simple and static, or you're on a tight credit budget (agent can consume hundreds of credits per run).

```json
{
  "prompt": "Extract all product names, prices, and descriptions from this page",
  "urls": ["https://example.com/products"],
  "model": "spark-1-mini",
  "maxCredits": 500
}
```

Parameters:
- `prompt` (required) -- What data to extract. Be specific.
- `urls` -- URLs to constrain the agent to.
- `schema` -- JSON schema for structured output.
- `maxCredits` -- Credit budget (default 2500).
- `strictConstrainToURLs` -- Only visit provided URLs.
- `model` -- `spark-1-mini` (default, cheaper) or `spark-1-pro` (higher accuracy).
### firecrawl_parse -- 1 credit/page

Upload a local file (PDF, DOCX, XLSX, HTML) and parse it into clean markdown or structured JSON.

**Best for:** Processing documents you already have locally -- PDFs, Word docs, spreadsheets. Good for feeding paper PDFs, contract docs, or data spreadsheets into your agent's context. Uses Firecrawl's Rust engine so it's fast and preserves table structure.

**Avoid when:** The document is publicly accessible by URL (use scrape instead -- it auto-detects file type from the URL and costs the same).

```json
{
  "file": "<base64-encoded-file-content>",
  "fileName": "report.pdf",
  "formats": ["markdown"],
  "parsers": [{ "type": "pdf", "mode": "auto", "maxPages": 100 }]
}
```

Parameters:
- `file` (required) -- Base64-encoded file content.
- `fileName` -- Original filename with extension.
- `formats` -- Output formats.
- `onlyMainContent` -- Exclude headers/navs/footers.
- `parsers` -- Parser config (e.g. PDF mode: fast/auto/ocr).

### firecrawl_interact -- 2 credits/minute

Create a Firecrawl browser session for interactive web tasks. Returns a CDP URL for browser control and live view URLs.

**Best for:** Sites that require login, multi-step forms, JavaScript-heavy SPAs that don't render with simple fetch, or any task where you need to click, type, and scroll. The session persists if you set a profile name.

**Avoid when:** The page works fine without login or interaction (use scrape -- it's 100x cheaper). Interact is the most expensive tool at 2 credits/minute, so use it only when scraping can't reach the content.

```json
{
  "ttl": 120,
  "activityTtl": 60,
  "profile": { "name": "my-session", "saveChanges": true }
}
```

Parameters:
- `ttl` -- Session lifetime in seconds (30-3600, default 600).
- `activityTtl` -- Inactivity timeout (10-3600, default 300).
- `profile` -- Persistent storage config across sessions.

## Command

```text
/firecrawl
```

Opens a menu with configuration, tool status, and controls.

```text
/firecrawl help       -- show command usage
/firecrawl config     -- show API key presence and URL
/firecrawl status     -- show tool and settings status
/firecrawl tools      -- select individual Firecrawl tools
/firecrawl enable     -- enable all tools
/firecrawl disable    -- disable all tools
```

## CI/CD

A GitHub Actions workflow (`upstream-check.yml`) runs daily to verify:

- Upstream `narumiruna/pi-extensions` hasn't broken our fork
- TypeScript compiles cleanly
- All 8 tool definitions are present and valid
- Multi-key client logic works

On failure, it automatically creates a GitHub issue.

## Package layout

```txt
src/
  index.ts        # Pi package entrypoint
  firecrawl.ts    # Extension registration and command orchestration
  client.ts       # Multi-key manager, HTTP client, quota checking
  settings.ts     # Settings persistence and migration
  tool-selector.ts # Tool selection UI
  tools.ts        # All 8 tool definitions
test/
  firecrawl.test.ts
  support.ts
```

## Upstream

Forked from `@narumitw/pi-firecrawl` v0.30.1 ([source](https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-firecrawl)).

## License

MIT. See [`LICENSE`](./LICENSE).
