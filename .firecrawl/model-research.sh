#!/bin/bash
# Scrape Firecrawl docs for embedding model details
# Uses Firecrawl API directly

API_KEY=$(python -c "
import json
config = json.load(open('$HOME/.pi/agent/pi-firecrawl-keys.json'))
keys = config.get('keys', [])
if keys: print(keys[0]['key'])
else: print('none')
")

if [ "$API_KEY" = "none" ]; then
    echo "No API key found"
    exit 1
fi

echo "Using key: ${API_KEY:0:8}...${API_KEY: -4}"

# Function to scrape a URL
scrape() {
    local url=$1
    local output=$2
    echo "Scraping: $url"
    curl -s -X POST "https://api.firecrawl.dev/v1/scrape" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"url\": \"$url\", \"formats\": [\"markdown\"], \"onlyMainContent\": true}" \
        | python -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    content = data.get('data', {}).get('markdown', '')
    print(content[:5000])
else:
    print('Error:', data.get('error', 'unknown'))
" > "$output" 2>&1
    echo "Saved to: $output"
    echo "---"
}

# Scrape model documentation
mkdir -p .firecrawl/models

scrape "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2" ".firecrawl/models/minilm.md"
scrape "https://huggingface.co/BAAI/bge-small-en-v1.5" ".firecrawl/models/bge-small.md"
scrape "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5" ".firecrawl/models/nomic.md"
scrape "https://github.com/MinishLab/model2vec" ".firecrawl/models/model2vec.md"

echo "Done! Check .firecrawl/models/ for results"
