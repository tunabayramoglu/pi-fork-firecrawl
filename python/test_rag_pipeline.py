"""Comprehensive tests for rag_pipeline.py.

Each test patches CACHE_DIR / CACHE_DB / CONFIG_FILE to a private
temp directory so tests are fully isolated and leave no side effects.

Run: python -m pytest python/test_rag_pipeline.py -v
"""

import json
import shutil
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

import rag_pipeline as rp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def tmp_cache(tmp_path):
    """Point every module-level path to an isolated temp directory."""
    cache_dir = tmp_path / "rag-cache"
    cache_dir.mkdir()
    cache_db = cache_dir / "cache.db"
    config_file = cache_dir / "config.json"
    with (
        patch.object(rp, "CACHE_DIR", cache_dir),
        patch.object(rp, "CACHE_DB", cache_db),
        patch.object(rp, "CONFIG_FILE", config_file),
    ):
        yield {
            "dir": cache_dir,
            "db": cache_db,
            "config": config_file,
        }


# ---------------------------------------------------------------------------
# 1. test_config_file_exists
# ---------------------------------------------------------------------------

def test_config_file_exists():
    """CONFIG_FILE constant is defined and points to a Path."""
    assert isinstance(rp.CONFIG_FILE, Path)
    assert rp.CONFIG_FILE.name == "config.json"


# ---------------------------------------------------------------------------
# 2. test_load_config
# ---------------------------------------------------------------------------

def test_load_config(tmp_cache):
    """load_config returns DEFAULT_CONFIG when no file exists."""
    result = rp.load_config()
    assert result == rp.DEFAULT_CONFIG
    # Must be a copy, not the same object
    result["embedding_model"] = "MUTATED"
    assert rp.load_config()["embedding_model"] == rp.DEFAULT_CONFIG["embedding_model"]


# ---------------------------------------------------------------------------
# 3. test_save_and_load_config
# ---------------------------------------------------------------------------

def test_save_and_load_config(tmp_cache):
    """Round-trip: save then load returns identical data."""
    custom = {
        "embedding_model": "custom/model",
        "embedding_dim": 256,
        "similarity_threshold": 0.5,
        "max_entries": 500,
        "ttl_hours": 48,
        "chunk_size": 128,
        "chunk_overlap": 10,
        "embedding_backend": "onnx",
    }
    rp.save_config(custom)

    loaded = rp.load_config()
    assert loaded == custom
    # File physically exists on disk
    assert tmp_cache["config"].is_file()


# ---------------------------------------------------------------------------
# 4. test_store_entry
# ---------------------------------------------------------------------------

def test_store_entry(tmp_cache):
    """store_entry persists a row and returns success."""
    url = "https://example.com/page"
    content = "This is test content with enough words to trigger extraction. " * 5
    title = "Test Page"

    result = rp.store_entry(url, content, title)
    assert result["success"] is True
    assert result["url"] == url
    assert isinstance(result["summary"], str)
    assert len(result["summary"]) > 0

    # Verify row exists in DB
    db = sqlite3.connect(str(tmp_cache["db"]))
    row = db.execute("SELECT url, title, content FROM cache_entries").fetchone()
    db.close()
    assert row is not None
    assert row[0] == url
    assert row[1] == title
    assert row[2] == content


def test_store_entry_with_metadata(tmp_cache):
    """store_entry uses metadata for content_type and credits_used."""
    url = "https://example.com/meta"
    content = "Metadata test content. " * 10
    metadata = {"content_type": "article", "credits_used": 3}

    rp.store_entry(url, content, metadata=metadata)

    db = sqlite3.connect(str(tmp_cache["db"]))
    row = db.execute(
        "SELECT content_type, credits_used FROM cache_entries WHERE url = ?",
        (url,),
    ).fetchone()
    db.close()
    assert row[0] == "article"
    assert row[1] == 3


def test_store_entry_without_metadata(tmp_cache):
    """store_entry uses defaults when metadata is None."""
    url = "https://example.com/no-meta"
    content = "No metadata test content here. " * 5

    rp.store_entry(url, content)

    db = sqlite3.connect(str(tmp_cache["db"]))
    row = db.execute(
        "SELECT content_type, credits_used FROM cache_entries WHERE url = ?",
        (url,),
    ).fetchone()
    db.close()
    assert row[0] == "unknown"
    assert row[1] == 1


# ---------------------------------------------------------------------------
# 5. test_query_cache
# ---------------------------------------------------------------------------

def test_query_cache_empty(tmp_cache):
    """query_cache on an empty DB returns no results."""
    result = rp.query_cache("anything")
    assert result["results"] == []
    assert result["query"] == "anything"


def test_query_cache_returns_results(tmp_cache):
    """After storing, query_cache finds the entry."""
    url = "https://example.com/findme"
    content = "Python programming language tutorial for beginners. " * 5
    rp.store_entry(url, content, title="Python Tutorial")

    result = rp.query_cache("Python programming tutorial", threshold=0.0)
    assert len(result["results"]) >= 1
    first = result["results"][0]
    assert first["url"] == url
    assert first["title"] == "Python Tutorial"
    assert "score" in first
    assert first["score"] >= 0


def test_query_cache_respects_top_k(tmp_cache):
    """query_cache returns at most top_k results."""
    for i in range(8):
        rp.store_entry(
            f"https://example.com/page{i}",
            f"Unique content number {i} with specific details about topic {i}. " * 5,
        )
    result = rp.query_cache("content", top_k=3, threshold=0.0)
    assert len(result["results"]) <= 3


def test_query_cache_respects_threshold(tmp_cache):
    """Only results above the similarity threshold are returned."""
    rp.store_entry(
        "https://example.com/specific",
        "Advanced quantum computing research paper on qubit entanglement. " * 5,
    )
    # Very high threshold should filter everything with pseudo-embeddings
    result = rp.query_cache("unrelated cooking recipe", threshold=0.99)
    # With pseudo-embeddings, similarity is hash-based; high threshold may filter
    for r in result["results"]:
        assert r["score"] >= 0.99


# ---------------------------------------------------------------------------
# 6. test_get_stats
# ---------------------------------------------------------------------------

def test_get_stats_empty(tmp_cache):
    """get_stats returns zeros for an empty database."""
    stats = rp.get_stats()
    assert stats["total_entries"] == 0
    assert stats["unique_domains"] == 0
    assert stats["avg_access_count"] == 0


def test_get_stats_after_store(tmp_cache):
    """get_stats reflects stored entries."""
    rp.store_entry("https://a.com/1", "Content one " * 10)
    rp.store_entry("https://b.com/2", "Content two " * 10)
    rp.store_entry("https://a.com/3", "Content three " * 10)

    stats = rp.get_stats()
    assert stats["total_entries"] == 3
    assert stats["unique_domains"] == 2  # a.com, b.com
    assert stats["embedding_model"] == rp.DEFAULT_CONFIG["embedding_model"]
    assert stats["embedding_dim"] == rp.DEFAULT_CONFIG["embedding_dim"]
    assert isinstance(stats["similarity_threshold"], (int, float))


# ---------------------------------------------------------------------------
# 7. test_preprocess_text
# ---------------------------------------------------------------------------

def test_preprocess_text_strips_url_parts(tmp_cache):
    """preprocess_text extracts hostname and path segments."""
    result = rp.preprocess_text("https://www.example.com/docs/guide")
    assert "example.com" in result
    assert "docs" in result
    assert "guide" in result
    # www. prefix removed
    assert "www." not in result
    # All lowercase
    assert result == result.lower()


def test_preprocess_text_includes_title(tmp_cache):
    """preprocess_text appends the title."""
    result = rp.preprocess_text(
        "https://example.com/page",
        title="My Page Title",
    )
    assert "my page title" in result


def test_preprocess_text_includes_content(tmp_cache):
    """preprocess_text appends first 500 chars of content."""
    content = "A" * 1000
    result = rp.preprocess_text(
        "https://example.com/page",
        content=content,
    )
    # Content is truncated to 500 chars
    assert "a" * 500 in result
    assert "a" * 501 not in result


def test_preprocess_text_empty(tmp_cache):
    """preprocess_text handles all-empty inputs gracefully."""
    result = rp.preprocess_text("")
    assert isinstance(result, str)
    # Should not raise


def test_preprocess_text_strips_index_files(tmp_cache):
    """index.html / index.php are excluded from path parts."""
    result = rp.preprocess_text("https://example.com/dir/index.html")
    assert "index.html" not in result
    assert "dir" in result


# ---------------------------------------------------------------------------
# 8. test_cosine_similarity
# ---------------------------------------------------------------------------

def test_cosine_similarity_identical_vectors():
    """Identical non-zero vectors have similarity 1.0."""
    v = [1.0, 2.0, 3.0]
    assert rp.cosine_similarity(v, v) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors():
    """Orthogonal vectors have similarity 0.0."""
    a = [1.0, 0.0, 0.0]
    b = [0.0, 1.0, 0.0]
    assert rp.cosine_similarity(a, b) == pytest.approx(0.0)


def test_cosine_similarity_opposite_vectors():
    """Opposite vectors have similarity -1.0."""
    a = [1.0, 2.0, 3.0]
    b = [-1.0, -2.0, -3.0]
    assert rp.cosine_similarity(a, b) == pytest.approx(-1.0)


def test_cosine_similarity_zero_vector():
    """Zero vector returns 0.0 to avoid division by zero."""
    a = [0.0, 0.0, 0.0]
    b = [1.0, 2.0, 3.0]
    assert rp.cosine_similarity(a, b) == 0.0
    assert rp.cosine_similarity(b, a) == 0.0


def test_cosine_similarity_different_lengths():
    """Vectors of different lengths are truncated to the shorter one."""
    a = [1.0, 2.0, 3.0, 4.0]
    b = [1.0, 2.0]
    # Truncated to dim 2: [1,2] vs [1,2] => identical => 1.0
    assert rp.cosine_similarity(a, b) == pytest.approx(1.0)


def test_cosine_similarity_numpy_input():
    """Works with numpy arrays as well as lists."""
    a = np.array([1.0, 0.0])
    b = np.array([0.0, 1.0])
    assert rp.cosine_similarity(a, b) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# 9. test_chunk_content
# ---------------------------------------------------------------------------

def test_chunk_content_short_text():
    """Content shorter than chunk_size returns a single chunk."""
    text = "Hello world"
    chunks = rp.chunk_content(text, chunk_size=512, overlap=50)
    assert chunks == ["Hello world"]


def test_chunk_content_long_text():
    """Longer text is split into multiple overlapping chunks."""
    words = [f"word{i}" for i in range(1000)]
    text = " ".join(words)
    chunks = rp.chunk_content(text, chunk_size=100, overlap=20)
    assert len(chunks) > 1
    # Each chunk should be at most 100 words
    for chunk in chunks:
        assert len(chunk.split()) <= 100


def test_chunk_content_overlap():
    """Adjacent chunks share overlapping words."""
    words = [f"w{i}" for i in range(200)]
    text = " ".join(words)
    chunks = rp.chunk_content(text, chunk_size=100, overlap=20)
    if len(chunks) >= 2:
        # Last 20 words of first chunk should appear in second chunk
        tail = chunks[0].split()[-20:]
        head = chunks[1].split()[:20]
        assert tail == head


def test_chunk_content_empty_string():
    """Empty content returns the empty string as a single chunk."""
    chunks = rp.chunk_content("")
    assert chunks == [""]


def test_chunk_content_no_overlap():
    """With overlap=0, chunks are contiguous (no shared words)."""
    words = [f"w{i}" for i in range(100)]
    text = " ".join(words)
    chunks = rp.chunk_content(text, chunk_size=50, overlap=0)
    assert len(chunks) == 2
    assert chunks[0].split()[-1] != chunks[1].split()[0]
