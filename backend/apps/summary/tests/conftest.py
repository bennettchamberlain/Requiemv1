"""
Shared env stubs for the summary test suite.

ci.summary.config instantiates Settings() at import time and hard-requires
DATABASE_URL; the LLM model must be named so nothing attempts endpoint
discovery. Set both before any ci.summary module is imported.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("LLM_DEFAULT_CHAT_MODEL", "test-model")
