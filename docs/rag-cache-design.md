# RAG Cache Design for Firecrawl Credit Optimization

## Goal
Replace URL-exact-match cache with semantic similarity cache using embeddings.
This allows cache hits even when URLs differ (different paths, query params, domains).

## Architecture

```
Incoming scrape request
  → hash URL → exact cache hit? → return cached (0 credits)
  → miss → compute embedding of URL + page title/description
       → ANN lookup in vector DB for similar cached scrapes
       → similarity > 0.85? → return cached (0 credits)
       → miss → call Firecrawl (spend credits) → embed + cache result
```

## Model Selection

**Primary: BAAI/bge-small-en-v1.5 (33M params, 32MB INT8)**
- Tiny, fast, excellent for cache lookup
- Pre-quantized: `Intel/bge-small-en-v1.5-rag-int8-static`
- OpenVINO compatible
- 384-dimensional embeddings

**Fallback: Qwen3-Embedding-0.6B (0.6B params)**
- Higher quality, multilingual
- OpenVINO IR format ready
- Use if bge-small accuracy is insufficient
## Vector Store

**sqlite-vss (recommended for Node.js)**
- npm package: `sqlite-vss`
- Works with `better-sqlite3`
- Pre-compiled extension for each platform
- Faiss-based vector search
- Single file storage, zero infrastructure

```typescript
import Database from "better-sqlite3";
import * as sqlite_vss from "sqlite-vss";

const db = new Database(":memory:");
sqlite_vss.load(db);
```
### 1. optimizer.ts — Cache Lookup
```typescript
// Before: exact URL match
const entry = store.scraped[url];

// After: exact match → semantic match
const entry = store.scraped[url] ?? await semanticLookup(url, title);
```

### 2. client.ts — Post-Scrape Caching
```typescript
// After successful scrape
const embedding = await embed(url + " " + title);
await vectorStore.insert(embedding, { url, content, credits });
```

### 3. bench-credits.js — Realistic Testing
- Pre-populate vector DB with sample embeddings
- Test cache hits on similar but different URLs
- Measure credit savings on real workloads

## Expected Impact

| Metric | Current (URL cache) | With RAG cache |
|---|---|---|
| Cache hit rate | ~30% (exact URL only) | ~60% (semantic match) |
| Credits per extraction | 0.81 | ~0.50 |
| Total reduction from baseline | 52.4% | ~70% |

## Implementation Order

1. Set up bge-small-en-v1.5 with OpenVINO
2. Add sqlite-vss for vector storage
3. Integrate embedding into cache flow
4. Update benchmark with semantic cache scenarios
5. Run autoresearch to optimize threshold and parameters
