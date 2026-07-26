# Embedding Models Research Summary

Scraped via Firecrawl on 2026-07-26.

## 1. all-MiniLM-L6-v2
- **Source**: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- **Params**: 22.7M
- **Dims**: 384
- **Max tokens**: 256
- **Training data**: 1.17B sentence pairs
- **License**: Apache-2.0
- **Downloads**: 253M
- **ONNX**: Yes
- **OpenVINO**: Yes
- **Usage**: `SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')`
- **Key feature**: Fastest, most downloaded, battle-tested

## 2. bge-small-en-v1.5
- **Source**: https://huggingface.co/BAAI/bge-small-en-v1.5
- **Params**: 33.4M
- **Dims**: 384
- **Max tokens**: 512
- **License**: MIT
- **Downloads**: 67.7M
- **ONNX**: Yes (included)
- **OpenVINO**: Yes (pre-quantized INT8 available)
- **Usage**: `SentenceTransformer('BAAI/bge-small-en-v1.5')`
- **Query instruction**: "Represent this sentence for searching relevant passages:"
- **MTEB Average**: 62.17
- **Key feature**: Best quality/size ratio, MIT license, INT8 pre-quantized

## 3. Model2Vec (potion-base-32M)
- **Source**: https://github.com/MinishLab/model2vec
- **Params**: 32.3M (potion-base-32M)
- **Dims**: 256
- **License**: MIT
- **Speed**: 500x faster than transformers
- **Dependencies**: numpy only
- **Models**: potion-base-32M (30MB), potion-base-8M (8MB), potion-base-4M (4MB), potion-base-2M (2MB)
- **Usage**: `StaticModel.from_pretrained("minishlab/potion-base-32M")`
- **Key feature**: Static embeddings, no attention, fastest possible

## 4. nomic-embed-text-v1.5
- **Source**: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
- **Params**: 137M (0.1B)
- **Dims**: 768 (MRL: 768→512→256→128→64)
- **Max tokens**: 8192
- **License**: Apache-2.0
- **Downloads**: 14.6M
- **ONNX**: Yes
- **Usage**: Requires task prefix (`search_document:`, `search_query:`)
- **MTEB**: 62.28 (768d), 61.96 (512d), 61.04 (256d)
- **Key feature**: 8K context, MRL truncation, multimodal support

## Recommendation for RAG Cache

| Use Case | Model | Why |
|---|---|---|
| **Fastest** | Model2Vec potion-base-8M | 8MB, 500x faster, numpy only |
| **Best quality/size** | bge-small-en-v1.5 | 33MB, INT8 pre-quantized, MIT |
| **Production** | nomic-embed-text-v1.5 | 8K context, MRL, multimodal |
| **Maximum compatibility** | all-MiniLM-L6-v2 | 253M downloads, battle-tested |

**For our RAG cache**: `all-MiniLM-L6-v2` — 46MB, 83ms, 384 dims, perfect for URL/content similarity.
