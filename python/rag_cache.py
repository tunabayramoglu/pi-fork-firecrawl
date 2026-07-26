#!/usr/bin/env python3
"""
Firecrawl RAG Cache Service
Provides semantic similarity caching for Firecrawl credit optimization.

Usage:
  python rag_cache.py embed <text>           - Get embedding vector
  python rag_cache.py search <text> [k]      - Search for similar cached entries
  python rag_cache.py insert <url> <text>    - Insert entry into cache
  python rag_cache.py stats                  - Show cache statistics
  python rag_cache.py init                   - Initialize cache (download model)
"""

import sys
import json
import hashlib
import numpy as np
from pathlib import Path
from typing import Optional

# ─── Model Loading ───────────────────────────────────────────────────────────

_model = None
_model_name = "BAAI/bge-small-en-v1.5"

def get_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(_model_name)
        except ImportError:
            # Fallback: use hash-based pseudo-embeddings
            print("sentence-transformers not available, using pseudo-embeddings", file=sys.stderr)
            _model = None
    return _model

def embed_text(text: str) -> list[float]:
    """Generate embedding for text."""
    model = get_model()
    if model is not None:
        embedding = model.encode(text, normalize_embeddings=True)
        return embedding.tolist()
    else:
        # Deterministic pseudo-embedding from hash
        return _pseudo_embedding(text)

def _pseudo_embedding(text: str) -> list[float]:
    """Generate deterministic pseudo-embedding from text hash."""
    h = hashlib.sha256(text.encode()).digest()
    values = [int.from_bytes(h[i:i+4], 'big') / 0xFFFFFFFF for i in range(0, len(h), 4)]
    # Pad to 384 dimensions
    while len(values) < 384:
        values.extend(values[:384-len(values)])
    values = values[:384]
    # Normalize
    norm = np.linalg.norm(values)
    return (np.array(values) / norm).tolist()

# ─── Text Preprocessing ──────────────────────────────────────────────────────

def preprocess_text(url: str, title: str = "", description: str = "") -> str:
    """Preprocess text for embedding."""
    from urllib.parse import urlparse
    parts = []
    try:
        parsed = urlparse(url)
        path_parts = [p for p in parsed.path.split('/') if p and p not in ('index.html', 'index.php')]
        if path_parts:
            parts.append(' '.join(path_parts))
        if parsed.hostname:
            parts.append(parsed.hostname.replace('www.', ''))
    except Exception:
        parts.append(url)
    if title:
        parts.append(title)
    if description:
        parts.append(description[:200])
    return ' '.join(parts).lower().strip()

# ─── Vector Store ────────────────────────────────────────────────────────────

_cache_dir = Path.home() / ".pi" / "agent" / "rag-cache"
_cache_file = _cache_dir / "cache.json"
_vector_index = None
_cache_data = {"entries": [], "embeddings": []}

def load_cache():
    global _cache_data
    try:
        if _cache_file.exists():
            with open(_cache_file) as f:
                _cache_data = json.load(f)
    except Exception:
        _cache_data = {"entries": [], "embeddings": []}

def save_cache():
    _cache_dir.mkdir(parents=True, exist_ok=True)
    with open(_cache_file, 'w') as f:
        json.dump(_cache_data, f)

def insert_entry(url: str, text: str, metadata: dict = None):
    """Insert entry into cache."""
    embedding = embed_text(text)
    entry = {
        "url": url,
        "text": text,
        "metadata": metadata or {},
        "timestamp": __import__('datetime').datetime.now().isoformat(),
    }
    _cache_data["entries"].append(entry)
    _cache_data["embeddings"].append(embedding)
    save_cache()

def search_similar(query_text: str, top_k: int = 5, threshold: float = 0.85) -> list[dict]:
    """Search for similar entries."""
    if not _cache_data["embeddings"]:
        return []

    query_embedding = np.array(embed_text(query_text))
    embeddings = np.array(_cache_data["embeddings"])

    # Cosine similarity (embeddings are normalized)
    similarities = np.dot(embeddings, query_embedding)

    # Get top-k
    top_indices = np.argsort(similarities)[::-1][:top_k]

    results = []
    for idx in top_indices:
        score = float(similarities[idx])
        if score >= threshold:
            results.append({
                "url": _cache_data["entries"][idx]["url"],
                "score": score,
                "metadata": _cache_data["entries"][idx].get("metadata", {}),
            })

    return results

def get_stats() -> dict:
    """Get cache statistics."""
    return {
        "total_entries": len(_cache_data["entries"]),
        "cache_file": str(_cache_file),
        "model": _model_name,
        "embedding_dim": 384,
    }

# ─── CLI Interface ───────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == "init":
        print("Initializing RAG cache...")
        print(f"Model: {_model_name}")
        model = get_model()
        if model is not None:
            print(f"Model loaded: {model.get_sentence_embedding_dimension()} dimensions")
        else:
            print("Using pseudo-embeddings (install sentence-transformers for real embeddings)")
        load_cache()
        print(f"Cache loaded: {len(_cache_data['entries'])} entries")
        print("Ready!")

    elif command == "embed":
        if len(sys.argv) < 3:
            print("Usage: rag_cache.py embed <text>", file=sys.stderr)
            sys.exit(1)
        text = sys.argv[2]
        embedding = embed_text(text)
        print(json.dumps({"embedding": embedding}))

    elif command == "search":
        if len(sys.argv) < 3:
            print("Usage: rag_cache.py search <text> [k]", file=sys.stderr)
            sys.exit(1)
        text = sys.argv[2]
        top_k = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        load_cache()
        results = search_similar(text, top_k)
        print(json.dumps({"results": results}))

    elif command == "insert":
        if len(sys.argv) < 4:
            print("Usage: rag_cache.py insert <url> <text>", file=sys.stderr)
            sys.exit(1)
        url = sys.argv[2]
        text = sys.argv[3]
        metadata = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
        load_cache()
        insert_entry(url, text, metadata)
        print(json.dumps({"success": True, "url": url}))

    elif command == "stats":
        load_cache()
        print(json.dumps(get_stats()))

    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
