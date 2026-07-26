#!/usr/bin/env python3
"""
Export BGE-M3 to OpenVINO IR format with INT8 quantization.

Usage:
  python export_openvino.py                  # Export with INT8 weights
  python export_openvino.py --format fp16    # Export with FP16 weights
  python export_openvino.py --format int4    # Export with INT4 weights (smallest)
  python export_openvino.py --test           # Test the exported model
"""

import argparse
import sys
import os
from pathlib import Path

MODEL_ID = "BAAI/bge-m3"
OUTPUT_DIR = Path(__file__).parent.parent / "models" / "bge-m3-openvino"

def export_model(weight_format: str = "int8"):
    """Export BGE-M3 to OpenVINO IR format."""
    print(f"Exporting {MODEL_ID} to OpenVINO ({weight_format})...")

    try:
        from optimum.intel import OVModelForFeatureExtraction
        from transformers import AutoTokenizer

        # Load and export
        print("Loading model from HuggingFace...")
        model = OVModelForFeatureExtraction.from_pretrained(
            MODEL_ID,
            export=True,
            load_in_8bit=(weight_format == "int8"),
        )

        print(f"Saving to {OUTPUT_DIR}...")
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(str(OUTPUT_DIR))

        # Save tokenizer
        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        tokenizer.save_pretrained(str(OUTPUT_DIR))

        print(f"Export complete: {OUTPUT_DIR}")
        print(f"Model size: {sum(f.stat().st_size for f in OUTPUT_DIR.rglob('*') if f.is_file()) / 1024 / 1024:.1f} MB")

        return True

    except ImportError as e:
        print(f"Missing dependency: {e}")
        print("Install with: pip install optimum-intel openvino")
        return False

def export_cli(weight_format: str = "int8"):
    """Export using optimum-cli."""
    import subprocess

    cmd = [
        "optimum-cli", "export", "openvino",
        "--model", MODEL_ID,
        "--weight-format", weight_format,
        str(OUTPUT_DIR),
    ]

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Export failed: {result.stderr}")
        return False

    print(f"Export complete: {OUTPUT_DIR}")
    return True

def test_model():
    """Test the exported OpenVINO model."""
    try:
        from optimum.intel import OVModelForFeatureExtraction
        from transformers import AutoTokenizer
        import numpy as np

        print(f"Loading model from {OUTPUT_DIR}...")
        model = OVModelForFeatureExtraction.from_pretrained(str(OUTPUT_DIR))
        tokenizer = AutoTokenizer.from_pretrained(str(OUTPUT_DIR))

        # Test embedding
        texts = [
            "Firecrawl authentication uses API keys",
            "Rate limits are per team",
        ]

        print("Generating embeddings...")
        inputs = tokenizer(texts, padding=True, truncation=True, return_tensors="pt")
        outputs = model(**inputs)

        # Mean pooling
        embeddings = outputs.last_hidden_state.mean(dim=1)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)

        print(f"Embedding shape: {embeddings.shape}")
        print(f"Embedding dim: {embeddings.shape[1]}")

        # Test similarity
        sim = np.dot(embeddings[0].detach().numpy(), embeddings[1].detach().numpy())
        print(f"Similarity between texts: {sim:.4f}")

        return True

    except Exception as e:
        print(f"Test failed: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Export BGE-M3 to OpenVINO")
    parser.add_argument("--format", choices=["fp16", "int8", "int4"], default="int8",
                       help="Weight format (default: int8)")
    parser.add_argument("--test", action="store_true", help="Test the exported model")
    parser.add_argument("--cli", action="store_true", help="Use optimum-cli instead of Python API")
    args = parser.parse_args()

    if args.test:
        success = test_model()
    elif args.cli:
        success = export_cli(args.format)
    else:
        success = export_model(args.format)

    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
