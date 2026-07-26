# sqlite-vss Node.js Guide

Source: https://alexgarcia.xyz/sqlite-vss/nodejs.html

## Installation

```bash
npm install sqlite-vss better-sqlite3
```

## Basic Usage

```typescript
import Database from "better-sqlite3";
import * as sqlite_vss from "sqlite-vss";

const db = new Database(":memory:");
sqlite_vss.load(db);

// Check version
const version = db.prepare("select vss_version()").pluck().get();
console.log(version);
```

## Creating a Vector Table

```sql
CREATE VIRTUAL TABLE vss0 USING vss0(
  embedding(384)  -- 384 dimensions for bge-small-en-v1.5
);
```

## Inserting Vectors

```sql
INSERT INTO vss0 (embedding) VALUES (?);
-- Pass Float32Array as parameter
```

## Similarity Search

```sql
SELECT
  rowid,
  distance
FROM vss0
WHERE vss_search(embedding, ?)
ORDER BY distance
LIMIT 5;
-- Pass query vector as parameter
```

## TypeScript Example

```typescript
import Database from "better-sqlite3";
import * as sqlite_vss from "sqlite-vss";

interface CacheEntry {
  url: string;
  embedding: Float32Array;
  credits: number;
}

const db = new Database("./firecrawl-cache.db");
sqlite_vss.load(db);

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    embedding BLOB NOT NULL,
    credits INTEGER DEFAULT 1
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS vss0 USING vss0(
    embedding(384)
  );
`);

// Insert
function insertCache(url: string, embedding: number[], credits: number) {
  const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
  db.prepare("INSERT INTO cache (url, embedding, credits) VALUES (?, ?, ?)")
    .run(url, embeddingBlob, credits);
  db.prepare("INSERT INTO vss0 (embedding) VALUES (?)")
    .run(embeddingBlob);
}

// Search
function searchSimilar(queryEmbedding: number[], limit = 5, threshold = 0.85) {
  const queryBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
  return db.prepare(`
    SELECT c.url, c.credits, v.distance
    FROM vss0 v
    JOIN cache c ON c.id = v.rowid
    WHERE vss_search(v.embedding, ?)
    ORDER BY v.distance
    LIMIT ?
  `).all(queryBlob, limit)
    .filter((row: any) => row.distance <= (1 - threshold));
}
```

## Performance Notes
- VSS index is built lazily on first search
- For >10K vectors, consider building index explicitly
- Memory usage: ~4 bytes per dimension per vector
- Search speed: O(n) for small datasets, O(log n) with index
