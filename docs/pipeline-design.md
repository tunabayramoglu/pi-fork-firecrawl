# Firecrawl RAG Cache Pipeline — Full Design

## Vision

Not a URL cache. A **knowledge cache** that:
- Stores scraped content with semantic embeddings
- Retrieves relevant content for ANY query (not just URL matches)
- Reduces Firecrawl API calls by reusing previously extracted knowledge
- Gets smarter over time as more content is cached

## The Problem We're Solving

Today:
```
User: "How does firecrawl authentication work?"
Agent: *scrapes firecrawl docs* (1 credit)
User: "What about API key rotation?"
Agent: *scrapes firecrawl docs AGAIN* (1 credit)
User: "Show me the rate limits"
Agent: *scrapes firecrawl docs AGAIN* (1 credit)
Total: 3 credits for 3 questions about the same docs
```

With RAG cache:
```
User: "How does firecrawl authentication work?"
Agent: *scrapes firecrawl docs* (1 credit) → caches content + embeddings
User: "What about API key rotation?"
Agent: *searches cache* → finds auth page (0 credits)
User: "Show me the rate limits"
Agent: *searches cache* → finds rate limits page (0 credits)
Total: 1 credit for 3 questions
```

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     FIRECRAWL RAG PIPELINE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   INGEST     │    │   RETRIEVE   │    │   MANAGE     │      │
│  │              │    │              │    │              │      │
│  │ Scrape       │    │ Query        │    │ Evict stale  │      │
│  │ Embed        │◄──►│ Embed        │    │ Merge dupes  │      │
│  │ Store        │    │ Search       │    │ Track usage  │      │
│  │ Index        │    │ Rank         │    │ Budget ctrl  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌─────────────────────────────────────────────────────┐       │
│  │                  VECTOR STORE                       │       │
│  │  (sqlite-vss / FAISS / in-memory)                  │       │
│  │                                                     │       │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │       │
│  │  │ URL     │ │ Content │ │ Embed   │ │ Meta    │  │       │
│  │  │ index   │ │ store   │ │ vectors │ │ data    │  │       │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │       │
│  └─────────────────────────────────────────────────────┘       │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │              EMBEDDING SERVICE                       │       │
│  │                                                     │       │
│  │  Option A: OpenVINO Model Server (bge-m3)           │       │
│  │  Option B: sentence-transformers (local)             │       │
│  │  Option C: Model2Vec (ultra-fast static)             │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Flow

### Flow 1: Cache Miss → Scrape → Store

```
User Request: "scrape firecrawl auth docs"
    │
    ▼
┌─────────────────────────┐
│ 1. QUERY PROCESSING     │
│    Parse intent         │
│    Extract: topic="auth"│
│    Extract: domain="firecrawl.dev" │
│    Extract: type="docs" │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 2. CACHE LOOKUP         │
│    a) Exact URL match   │ → HIT: return cached
│    b) Semantic search   │ → HIT: return cached
│    c) Keyword search    │ → HIT: return cached
│    d) No match          │ → MISS: proceed
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 3. SCRAPE               │
│    Call Firecrawl API   │
│    Get content          │
│    Cost: 1 credit       │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 4. PROCESS              │
│    Extract clean text   │
│    Generate summary     │
│    Extract metadata     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 5. EMBED                │
│    Generate embedding   │
│    Generate summary     │
│    embedding            │
│    Generate keyword     │
│    embedding            │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 6. STORE                │
│    Save to vector DB    │
│    Save content to      │
│    content store        │
│    Update indexes       │
│    Track usage          │
└─────────────────────────┘
```

### Flow 2: Cache Hit → Retrieve

```
User Request: "what about API key rotation?"
    │
    ▼
┌─────────────────────────┐
│ 1. QUERY PROCESSING     │
│    Parse intent         │
│    Extract: topic="api key rotation" │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 2. CACHE LOOKUP         │
│    a) Exact URL match   │ → MISS
│    b) Semantic search   │ → HIT: "auth docs" (score: 0.92)
│    c) Keyword search    │ → HIT: "api key" docs (score: 0.87)
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 3. RANK & FILTER        │
│    Combine scores       │
│    Apply threshold      │
│    Return top-k         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ 4. RETURN               │
│    Return cached content│
│    Cost: 0 credits      │
│    Log cache hit        │
└─────────────────────────┘
```

## Storage Schema

### Vector Store (sqlite-vss)

```sql
CREATE TABLE cache_entries (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    summary TEXT,
    embedding BLOB NOT NULL,          -- 1024-dim float32
    summary_embedding BLOB,            -- 1024-dim float32
    keywords TEXT,                     -- JSON array
    domain TEXT,
    content_type TEXT,                 -- docs, blog, api, etc.
    language TEXT DEFAULT 'en',
    credits_used INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    expires_at TEXT,                   -- optional TTL
    metadata TEXT                      -- JSON blob
);

CREATE VIRTUAL TABLE cache_vss USING vss0(
    embedding(1024),
    summary_embedding(1024)
);

-- Indexes for fast lookup
CREATE INDEX idx_cache_url ON cache_entries(url);
CREATE INDEX idx_cache_domain ON cache_entries(domain);
CREATE INDEX idx_cache_content_type ON cache_entries(content_type);
CREATE INDEX idx_cache_updated ON cache_entries(updated_at);
```

### Content Store (SQLite)

```sql
CREATE TABLE content_chunks (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER REFERENCES cache_entries(id),
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    token_count INTEGER,
    UNIQUE(entry_id, chunk_index)
);

CREATE VIRTUAL TABLE content_vss USING vss0(
    embedding(1024)
);
```

## Embedding Strategy

### Multi-Level Embeddings

For each cached entry, we generate 3 types of embeddings:

1. **Content embedding** — full page content
   - Best for: "find pages about X"
   - Model: bge-m3 dense (1024 dims)

2. **Summary embedding** — condensed summary
   - Best for: quick similarity matching
   - Model: bge-m3 dense (1024 dims)

3. **Keyword embedding** — extracted keywords
   - Best for: exact term matching
   - Model: bge-m3 sparse (lexical weights)

### Embedding Flow

```
Scraped Content
    │
    ├─→ Content Embedding (1024 dims)
    │   "Full page text → bge-m3 → dense vector"
    │
    ├─→ Summary Embedding (1024 dims)
    │   "Extract summary → bge-m3 → dense vector"
    │
    └─→ Keyword Embedding (sparse)
        "Extract keywords → bge-m3 → lexical weights"
```

## Retrieval Strategy

### Multi-Stage Retrieval

```
Query
    │
    ▼
┌─────────────────────┐
│ Stage 1: Candidate  │
│ Generation          │
│                     │
│ a) Exact URL match  │
│ b) Semantic search  │
│    (content embed)  │
│ c) Keyword search   │
│    (sparse embed)   │
│ d) Domain filter    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Stage 2: Re-Ranking │
│                     │
│ a) Score fusion     │
│ b) Freshness boost  │
│ c) Relevance filter │
│ d) Deduplication    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Stage 3: Return     │
│                     │
│ a) Top-k results    │
│ b) Confidence score │
│ c) Source attribution│
└─────────────────────┘
```

### Score Fusion

```
final_score = (
    w1 * semantic_score +      // 0.5
    w2 * keyword_score +       // 0.3
    w3 * freshness_score +     // 0.1
    w4 * domain_match_score    // 0.1
)

// Threshold: 0.7 minimum for cache hit
```

## Cache Management

### Eviction Policy

```
┌─────────────────────────────────────────┐
│ EVICTION RULES                          │
├─────────────────────────────────────────┤
│ 1. TTL-based: expire after 24h          │
│ 2. LRU: evict least recently accessed   │
│ 3. Size-based: max 10K entries          │
│ 4. Domain-based: max 1K per domain      │
│ 5. Credit-based: evict when budget hit  │
└─────────────────────────────────────────┘
```

### Update Strategy

```
┌─────────────────────────────────────────┐
│ UPDATE RULES                            │
├─────────────────────────────────────────┤
│ 1. Same URL + fresh content → update    │
│ 2. Same URL + same content → skip       │
│ 3. Similar content → merge/supersede    │
│ 4. Outdated content → mark stale        │
└─────────────────────────────────────────┘
```

## Budget Management

### Credit Tracking

```json
{
  "monthly_budget": 10000,
  "used_this_month": 3500,
  "saved_by_cache": 6500,
  "cache_hit_rate": 0.72,
  "by_tool": {
    "scrape": { "used": 2000, "saved": 4000 },
    "search": { "used": 500, "saved": 1500 },
    "crawl": { "used": 1000, "saved": 1000 }
  }
}
```

### Cost Optimization Rules

```
┌─────────────────────────────────────────┐
│ COST RULES                              │
├─────────────────────────────────────────┤
│ 1. Always check cache before scraping   │
│ 2. Prefer map+scrape over crawl         │
│ 3. Use search (2cr) over scrape (1cr)   │
│    when discovery needed                │
│ 4. Use monitor over repeated scrape     │
│ 5. Set aggressive cache TTL for docs    │
│ 6. Set long cache TTL for static content│
└─────────────────────────────────────────┘
```

## Integration Points

### 1. Agent Tool Layer

```typescript
// Agent calls this instead of direct Firecrawl
const result = await firecrawlRag.retrieve({
  query: "firecrawl authentication docs",
  domain: "firecrawl.dev",
  type: "docs",
  maxAge: "24h",
  minScore: 0.7
});

if (result.cached) {
  return result.content;  // 0 credits
} else {
  const scraped = await firecrawl.scrape(result.url);
  await firecrawlRag.store(scraped);
  return scraped.content;  // 1 credit
}
```

### 2. Optimizer Integration

```typescript
// Optimizer decides: cache hit or scrape?
const decision = await optimizer.decide({
  goal: userGoal,
  url: targetUrl,
  budget: remainingBudget
});

// decision.action = "cache" | "scrape" | "search+scrape" | "map+scrape"
// decision.estimatedCredits = 0 | 1 | 2 | etc.
// decision.confidence = 0.0 - 1.0
```

### 3. Multi-Key Awareness

```typescript
// Track credits per key
const keyStatus = await keyManager.getStatus();
// { key: "fc-xxx", remaining: 4500, total: 5000 }

// Route to cheapest available key
const key = await keyManager.select cheapest();
```

## Model Selection for Pipeline

| Component | Model | Why |
|---|---|---|
| **Content embedding** | BGE-M3 (568M) | Best hybrid search, 8K context |
| **Summary embedding** | BGE-M3 (same) | Consistent vector space |
| **Keyword extraction** | BGE-M3 sparse | Built-in lexical weights |
| **Re-ranking** | BGE-reranker-v2 | Cross-encoder for precision |
| **Fallback** | Qwen3-0.6B | If BGE-M3 too heavy |

## Expected Impact

| Metric | Current | With Pipeline |
|---|---|---|
| Cache hit rate | ~30% | ~70% |
| Credits per extraction | 0.81 | ~0.30 |
| Total reduction | 52% | ~82% |
| Knowledge reuse | None | High |
| Query response time | 1-5s (API call) | <100ms (cache) |

## Implementation Phases

### Phase 1: Foundation (Current)
- [x] URL-based cache
- [x] Basic semantic search
- [ ] Content storage
- [ ] Summary generation

### Phase 2: Pipeline
- [ ] Multi-stage retrieval
- [ ] Score fusion
- [ ] Re-ranking
- [ ] Budget management

### Phase 3: Intelligence
- [ ] Auto-eviction
- [ ] Content deduplication
- [ ] Freshness detection
- [ ] Query understanding

### Phase 4: Scale
- [ ] Distributed vector store
- [ ] Async embedding
- [ ] Cache warming
- [ ] Analytics dashboard
