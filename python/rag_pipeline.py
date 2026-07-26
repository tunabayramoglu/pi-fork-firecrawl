#!/usr/bin/env python3
"""
Firecrawl RAG Pipeline - Phase 2
Full knowledge retrieval system with BGE-M3 embeddings.

Usage:
  python rag_pipeline.py query <text>           - Query the cache
  python rag_pipeline.py store <url> <content>  - Store scraped content
  python rag_pipeline.py stats                  - Show pipeline stats
  python rag_pipeline.py init                   - Initialize (download model)
  python rag_pipeline.py evict                  - Evict stale entries
"""

import sys
import json
import hashlib
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

# ─── Configuration ───────────────────────────────────────────────────────────

CACHE_DIR = Path.home() / ".pi" / "agent" / "rag-cache"
CACHE_DB = CACHE_DIR / "cache.db"
USAGE_FILE = CACHE_DIR / "usage.json"
CONFIG_FILE = CACHE_DIR / "config.json"

DEFAULT_CONFIG = {
    # Model selection - supports any of these formats:
    #   "BAAI/bge-m3"                    → HuggingFace model ID (sentence-transformers)
    #   "sentence-transformers/all-MiniLM-L6-v2" → HuggingFace model ID
    #   "/path/to/model"                 → Local model directory
    #   "openvino:/path/to/model"        → OpenVINO IR model
    #   "onnx:/path/to/model.onnx"       → ONNX model
    #   "model2vec:minishlab/potion-base-32M" → Model2Vec static model
    "embedding_model": "BAAI/bge-m3",
    "embedding_backend": "auto",  # auto | sentence-transformers | openvino | onnx | model2vec
    "embedding_dim": 1024,
    "similarity_threshold": 0.75,
    "max_entries": 10000,
    "ttl_hours": 24,
    "chunk_size": 512,
    "chunk_overlap": 50,
}
# ─── Model State ──────────────────────────────────────────────────────────────
_model = None
_model_name = None
def get_model():
    """Load embedding model based on config. Supports multiple backends."""
    global _model, _model_name
    if _model is not None:
        return _model

    config = load_config()
    model_spec = config.get("embedding_model", "BAAI/bge-m3")
    backend = config.get("embedding_backend", "auto")

    # Auto-detect backend from model spec
    if backend == "auto":
        if model_spec.startswith("openvino:"):
            backend = "openvino"
        elif model_spec.startswith("onnx:"):
            backend = "onnx"
        elif model_spec.startswith("model2vec:"):
            backend = "model2vec"
        elif "/" in model_spec and not model_spec.startswith("/"):
            backend = "sentence-transformers"
        else:
            backend = "sentence-transformers"

    print(f"Loading model: {model_spec} (backend: {backend})", file=sys.stderr)

    try:
        if backend == "sentence-transformers":
            return _load_sentence_transformers(model_spec)
        elif backend == "openvino":
            return _load_openvino(model_spec.replace("openvino:", ""))
        elif backend == "onnx":
            return _load_onnx(model_spec.replace("onnx:", ""))
        elif backend == "model2vec":
            return _load_model2vec(model_spec.replace("model2vec:", ""))
        else:
            print(f"Unknown backend: {backend}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"Failed to load model: {e}", file=sys.stderr)
        return None

def _load_sentence_transformers(model_name: str):
    """Load via sentence-transformers."""
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(model_name)
    _model_name = model_name
    dim = model.get_sentence_embedding_dimension()
    print(f"Loaded {model_name}: {dim} dimensions", file=sys.stderr)
    return model

def _load_openvino(model_path: str):
    """Load via OpenVINO (optimum-intel)."""
    from optimum.intel import OVModelForFeatureExtraction
    from transformers import AutoTokenizer
    model = OVModelForFeatureExtraction.from_pretrained(model_path)
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    _model_name = f"openvino:{model_path}"
    # Wrap in a simple class for consistent interface
    return _OpenVINOModel(model, tokenizer)

def _load_onnx(model_path: str):
    """Load via ONNX Runtime."""
    try:
        from optimum.onnxruntime import ORTModelForFeatureExtraction
        from transformers import AutoTokenizer
        model = ORTModelForFeatureExtraction.from_pretrained(model_path)
        tokenizer = AutoTokenizer.from_pretrained(model_path)
        _model_name = f"onnx:{model_path}"
        return _ONNXModel(model, tokenizer)
    except ImportError:
        print("onnxruntime not available", file=sys.stderr)
        return None

def _load_model2vec(model_name: str):
    """Load via Model2Vec (static embeddings)."""
    from model2vec import StaticModel
    model = StaticModel.from_pretrained(model_name)
    _model_name = f"model2vec:{model_name}"
    return _Model2VecWrapper(model)

class _OpenVINOModel:
    """Wrapper for OpenVINO model to match sentence-transformers interface."""
    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer
        self._dim = 1024  # BGE-M3 default

    def get_sentence_embedding_dimension(self):
        return self._dim

    def encode(self, sentences, normalize_embeddings=True, **kwargs):
        import torch
        if isinstance(sentences, str):
            sentences = [sentences]
        inputs = self.tokenizer(sentences, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**inputs)
        embeddings = outputs.last_hidden_state[:, 0]  # CLS pooling
        if normalize_embeddings:
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
        return embeddings.numpy()

class _ONNXModel:
    """Wrapper for ONNX model to match sentence-transformers interface."""
    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer
        self._dim = 1024

    def get_sentence_embedding_dimension(self):
        return self._dim

    def encode(self, sentences, normalize_embeddings=True, **kwargs):
        import torch
        if isinstance(sentences, str):
            sentences = [sentences]
        inputs = self.tokenizer(sentences, padding=True, truncation=True, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**inputs)
        embeddings = outputs.last_hidden_state[:, 0]
        if normalize_embeddings:
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
        return embeddings.numpy()

class _Model2VecWrapper:
    """Wrapper for Model2Vec to match sentence-transformers interface."""
    def __init__(self, model):
        self.model = model
        self._dim = model.get_sentence_embedding_dimension()

    def get_sentence_embedding_dimension(self):
        return self._dim

    def encode(self, sentences, normalize_embeddings=True, **kwargs):
        return self.model.encode(sentences)

def embed_text(text: str) -> list[float]:
    """Generate embedding for text."""
    model = get_model()
    if model is not None:
        embedding = model.encode(text, normalize_embeddings=True)
        import numpy as np
        embedding = np.array(embedding)
        if embedding.ndim > 1:
            embedding = embedding[0]
        return embedding.tolist()
    else:
        return _pseudo_embedding(text)

def _pseudo_embedding(text: str) -> list[float]:
    """Deterministic pseudo-embedding from text hash."""
    h = hashlib.sha256(text.encode()).digest()
    values = [int.from_bytes(h[i:i+4], 'big') / 0xFFFFFFFF for i in range(0, len(h), 4)]
    while len(values) < 1024:
        values.extend(values[:1024-len(values)])
    values = values[:1024]
    norm = np.linalg.norm(values)
    return (np.array(values) / norm).tolist()

# ─── Content Processing ──────────────────────────────────────────────────────

def preprocess_text(url: str, title: str = "", content: str = "") -> str:
    """Preprocess text for embedding."""
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
    if content:
        # Take first 500 chars of content for embedding
        parts.append(content[:500])
    return ' '.join(parts).lower().strip()

def extract_summary(content: str, max_length: int = 200) -> str:
    """Extract a summary from content."""
    # Simple extractive summary - first N sentences
    sentences = content.replace('\n', ' ').split('. ')
    summary = '. '.join(sentences[:3])
    if len(summary) > max_length:
        summary = summary[:max_length] + '...'
    return summary

def extract_keywords(content: str, top_k: int = 10) -> list[str]:
    """Extract keywords from content."""
    # Simple TF-based keyword extraction
    words = content.lower().split()
    word_freq = {}
    for word in words:
        if len(word) > 3:  # Skip short words
            word_freq[word] = word_freq.get(word, 0) + 1
    sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
    return [w for w, _ in sorted_words[:top_k]]

def chunk_content(content: str, chunk_size: int = 512, overlap: int = 50) -> list[str]:
    """Split content into overlapping chunks."""
    words = content.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = ' '.join(words[i:i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
    return chunks if chunks else [content]

# ─── Vector Store ────────────────────────────────────────────────────────────

def init_db():
    """Initialize SQLite database with vector search support."""
    try:
        import sqlite3
        db = sqlite3.connect(str(CACHE_DB))

        db.execute("""
            CREATE TABLE IF NOT EXISTS cache_entries (
                id INTEGER PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT,
                content TEXT NOT NULL,
                summary TEXT,
                embedding BLOB,
                keywords TEXT,
                domain TEXT,
                content_type TEXT,
                credits_used INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                access_count INTEGER DEFAULT 0,
                last_accessed TEXT
            )
        """)

        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_cache_url ON cache_entries(url)
        """)
        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_cache_domain ON cache_entries(domain)
        """)

        db.commit()
        return db
    except Exception as e:
        print(f"SQLite error: {e}", file=sys.stderr)
        return None

def cosine_similarity(a: list[float], b: list[float]) -> float:
	"""Calculate cosine similarity between two vectors."""
	a = np.array(a, dtype=np.float32)
	b = np.array(b, dtype=np.float32)
	if a.shape[0] != b.shape[0]:
		# Truncate to smaller dimension
		min_dim = min(a.shape[0], b.shape[0])
		a = a[:min_dim]
		b = b[:min_dim]
	norm_a = np.linalg.norm(a)
	norm_b = np.linalg.norm(b)
	if norm_a == 0 or norm_b == 0:
		return 0.0
	return float(np.dot(a, b) / (norm_a * norm_b))

def store_entry(url: str, content: str, title: str = "", metadata: dict = None):
    """Store scraped content in the cache."""
    db = init_db()
    if not db:
        return {"error": "Failed to initialize database"}

    # Process content
    now = datetime.now().isoformat()
    summary = extract_summary(content)
    keywords = extract_keywords(content)
    text_for_embedding = preprocess_text(url, title, content)
    embedding = embed_text(text_for_embedding)
    # Ensure consistent dimension
    embedding = np.array(embedding, dtype=np.float32)
    if embedding.shape[0] > 1024:
        embedding = embedding[:1024]
    elif embedding.shape[0] < 1024:
        embedding = np.pad(embedding, (0, 1024 - embedding.shape[0]))

    # Extract domain
    try:
        domain = urlparse(url).hostname or "unknown"
    except Exception:
        domain = "unknown"

    db.execute("""
        INSERT INTO cache_entries
        (url, title, content, summary, embedding, keywords, domain, content_type, credits_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        url, title, content, summary,
        embedding.tobytes(),
        json.dumps(keywords), domain, metadata.get("content_type", "unknown") if metadata else "unknown",
        metadata.get("credits_used", 1) if metadata else 1,
        now, now
    ))
    db.commit()

    return {"success": True, "url": url, "summary": summary[:100]}

def query_cache(query: str, top_k: int = 5, threshold: float = 0.75):
    """Query the cache for similar content."""
    db = init_db()
    if not db:
        return {"error": "Failed to initialize database"}

    # Generate query embedding
    query_embedding = embed_text(query)

    # Get all entries
    cursor = db.execute("""
        SELECT id, url, title, summary, content, embedding, domain, access_count
        FROM cache_entries
        ORDER BY updated_at DESC
    """)
    entries = cursor.fetchall()

    if not entries:
        return {"results": [], "query": query}

    # Calculate similarities
    results = []
    for entry in entries:
        entry_id, url, title, summary, content, embedding_bytes, domain, access_count = entry
        if embedding_bytes:
            entry_embedding = np.frombuffer(embedding_bytes, dtype=np.float32).tolist()
            score = cosine_similarity(query_embedding, entry_embedding)
            if score >= threshold:
                results.append({
                    "id": entry_id,
                    "url": url,
                    "title": title,
                    "summary": summary,
                    "content": content[:500] if content else "",
                    "score": score,
                    "domain": domain,
                    "access_count": access_count,
                })
    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    # Update access counts
    for r in results[:top_k]:
        db.execute("""
            UPDATE cache_entries
            SET access_count = access_count + 1, last_accessed = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), r["id"]))
    db.commit()

    return {"results": results[:top_k], "query": query}

def get_stats():
    """Get pipeline statistics."""
    db = init_db()
    if not db:
        return {"error": "Failed to initialize database"}

    cursor = db.execute("SELECT COUNT(*) FROM cache_entries")
    total = cursor.fetchone()[0]

    cursor = db.execute("SELECT COUNT(DISTINCT domain) FROM cache_entries")
    domains = cursor.fetchone()[0]

    cursor = db.execute("SELECT AVG(access_count) FROM cache_entries")
    avg_access = cursor.fetchone()[0] or 0

    config = load_config()
    return {
        "total_entries": total,
        "unique_domains": domains,
        "avg_access_count": round(avg_access, 2),
        "embedding_model": config.get("embedding_model", "unknown"),
        "embedding_dim": config.get("embedding_dim", 1024),
        "similarity_threshold": config.get("similarity_threshold", 0.75),
        "max_entries": config.get("max_entries", 10000),
    }

def evict_stale():
    """Evict stale entries based on TTL."""
    db = init_db()
    if not db:
        return {"error": "Failed to initialize database"}

    config = load_config()
    ttl_hours = config.get("ttl_hours", 24)
    cutoff = (datetime.now() - timedelta(hours=ttl_hours)).isoformat()

    cursor = db.execute("""
        DELETE FROM cache_entries
        WHERE updated_at < ? AND access_count < 2
    """, (cutoff,))
    deleted = cursor.rowcount
    db.commit()

    return {"deleted": deleted, "cutoff": cutoff}

# ─── Config Management ───────────────────────────────────────────────────────

def load_config() -> dict:
    """Load pipeline configuration."""
    try:
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE) as f:
                return json.load(f)
    except Exception:
        pass
    return DEFAULT_CONFIG.copy()

def save_config(config: dict):
    """Save pipeline configuration."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

# ─── CLI Interface ───────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == "init":
        print("Initializing RAG Pipeline...")
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        config = load_config()
        save_config(config)
        print(f"Config: {json.dumps(config, indent=2)}")
        model = get_model()
        if model:
            print(f"Model loaded: {model.get_sentence_embedding_dimension()} dimensions")
        else:
            print("Using pseudo-embeddings (install sentence-transformers for real embeddings)")
        db = init_db()
        if db:
            print("Database initialized")
        print("Ready!")

    elif command == "query":
        if len(sys.argv) < 3:
            print("Usage: rag_pipeline.py query <text>", file=sys.stderr)
            sys.exit(1)
        text = sys.argv[2]
        top_k = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.75
        results = query_cache(text, top_k, threshold)
        print(json.dumps(results, indent=2))

    elif command == "store":
        if len(sys.argv) < 4:
            print("Usage: rag_pipeline.py store <url> <content>", file=sys.stderr)
            sys.exit(1)
        url = sys.argv[2]
        content = sys.argv[3]
        title = sys.argv[4] if len(sys.argv) > 4 else ""
        result = store_entry(url, content, title)
        print(json.dumps(result))

    elif command == "stats":
        stats = get_stats()
        print(json.dumps(stats, indent=2))

    elif command == "evict":
        result = evict_stale()
        print(json.dumps(result))

    elif command == "config":
        if len(sys.argv) > 2:
            # Set config value
            key = sys.argv[2]
            value = sys.argv[3] if len(sys.argv) > 3 else ""
            config = load_config()
            config[key] = value
            save_config(config)
            print(f"Set {key} = {value}")
        else:
            # Show config
            config = load_config()
            print(json.dumps(config, indent=2))

    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
