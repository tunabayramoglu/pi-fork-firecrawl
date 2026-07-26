# OpenVINO Model Server — Embeddings Demo

Source: https://github.com/openvinotoolkit/model_server/blob/main/demos/embeddings/README.md

## How to Deploy

### Docker Command
```bash
docker run -d --user $(id -u):$(id -g) --rm -p 8000:8000 \
  -v $(pwd)/models:/models:rw \
  openvino/model_server:latest \
  --pull \
  --model_repository_path /models \
  --source_model OpenVINO/bge-small-en-v1.5 \
  --pooling CLS \
  --task embeddings
```

### REST API (OpenAI Compatible)
```bash
curl http://localhost:8000/v3/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bge-small-en-v1.5",
    "input": ["This is a test sentence"],
    "encoding_format": "float"
  }'
```

### Response Format
```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.0123, -0.0456, ...],
      "index": 0
    }
  ],
  "model": "bge-small-en-v1.5",
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

### Model Configuration
- **Model**: BAAI/bge-small-en-v1.5 (33M params)
- **Pooling**: CLS (classification token)
- **Task**: embeddings
- **Dimensions**: 384
- **Max sequence length**: 512 tokens

### Performance
- INT8 quantized: ~32MB
- Inference: <10ms per embedding on CPU
- Throughput: 100+ embeddings/second
