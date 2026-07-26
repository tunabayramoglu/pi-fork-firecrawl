# FixConfigFile: Done

## What was done
Added the missing `CONFIG_FILE` constant to `python/rag_pipeline.py`.

## Change
**File:** `python/rag_pipeline.py`  
**Line 44 (new):** `CONFIG_FILE = CACHE_DIR / 'config.json'`  
Inserted after the `DEFAULT_CONFIG` dict (line 43) and before the Model State section.

## Root cause
`CONFIG_FILE` was referenced on lines 455, 456, and 465 in `load_config()` and `save_config()`, but was never defined. `CACHE_DIR` was defined at line 24, so the fix is consistent with existing patterns.

## Verification
All 4 references to `CONFIG_FILE` now resolve:
- Line 44: definition
- Line 455: `CONFIG_FILE.exists()` in `load_config()`
- Line 456: `open(CONFIG_FILE)` in `load_config()`
- Line 465: `open(CONFIG_FILE, 'w')` in `save_config()`
