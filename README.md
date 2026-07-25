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

### firecrawl_scrape

Scrape a single URL into markdown, HTML, raw HTML, links, screenshots, or JSON.

```json
{ "url": "https://example.com", "formats": ["markdown"] }
```

### firecrawl_crawl

Start a site crawl job and return the Firecrawl job id.

```json
{ "url": "https://example.com", "limit": 10, "scrapeOptions": { "formats": ["markdown"] } }
```

### firecrawl_crawl_status

Check a crawl job status and retrieve completed crawl data.

```json
{ "id": "crawl-job-id" }
```

### firecrawl_map

Discover URLs for a site.

```json
{ "url": "https://example.com", "limit": 20 }
```

### firecrawl_search

Search the web through Firecrawl and optionally scrape result pages.

```json
{ "query": "firecrawl documentation", "limit": 5 }
```

### firecrawl_agent

Autonomous AI-powered web data extraction. Provide a prompt and optional URLs; the agent navigates, scrapes, and extracts structured data.

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

### firecrawl_parse

Upload a local file (PDF, DOCX, XLSX, HTML) and parse it into clean markdown or structured JSON.

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

### firecrawl_interact

Create a Firecrawl browser session for interactive web tasks. Returns a CDP URL for browser control and live view URLs.

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
