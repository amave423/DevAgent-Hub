"""Request-URL builder tests for the LLM provider layer.

Run: python scripts/test_url_builder.py
The assertion cases cover the reseller-API double-path bug that caused
502/HTML errors when a base URL already contains /chat/completions or
/messages and an endpoint path is also provided.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LLM_PATH = ROOT / "services" / "agent-api" / "app" / "llm.py"
MODEL_PATH = ROOT / "services" / "agent-api" / "app" / "models.py"

# Minimal sandbox so llm.py can resolve `from .models import ...` standalone.
models_spec = importlib.util.spec_from_file_location("app.models", MODEL_PATH)
models_module = importlib.util.module_from_spec(models_spec)
sys.modules["app.models"] = models_module
models_spec.loader.exec_module(models_module)  # type: ignore[union-attr]

llm_spec = importlib.util.spec_from_file_location("app.llm", LLM_PATH)
llm_module = importlib.util.module_from_spec(llm_spec)
sys.modules["app.llm"] = llm_module
llm_spec.loader.exec_module(llm_module)  # type: ignore[union-attr]

build_request_url = llm_module.build_request_url
infer_format_from_url = llm_module.infer_format_from_url


CASES = [
    # (base_url, endpoint_path, default_path, expected)
    ("https://api.openai.com/v1", None, "/chat/completions", "https://api.openai.com/v1/chat/completions"),
    ("https://api.openai.com/v1", "/chat/completions", "/chat/completions", "https://api.openai.com/v1/chat/completions"),
    # Reseller base already carries the endpoint path and no explicit endpoint_path.
    ("https://api.example.com/v1/chat/completions", None, "/chat/completions", "https://api.example.com/v1/chat/completions"),
    # Reseller base already carries the endpoint path WITH an explicit endpoint_path
    # that equals the suffix -> must NOT double to .../chat/completions/chat/completions.
    ("https://api.example.com/v1/chat/completions", "/chat/completions", "/chat/completions", "https://api.example.com/v1/chat/completions"),
    ("https://api.openai.com/v1/", None, "/chat/completions", "https://api.openai.com/v1/chat/completions"),
    ("https://api.openai.com/v1", "/v1/chat/completions", "/chat/completions", "https://api.openai.com/v1/chat/completions"),
    ("https://api.openai.com", None, "/messages", "https://api.openai.com/messages"),
    ("https://api.anthropic.com/v1", None, "/messages", "https://api.anthropic.com/v1/messages"),
    ("https://api.anthropic.com/v1", "/v1/messages", "/messages", "https://api.anthropic.com/v1/messages"),
    ("https://api.example.com/v1/messages", "/messages", "/messages", "https://api.example.com/v1/messages"),
    ("https://api.openai.com/v1", "", "/chat/completions", "https://api.openai.com/v1/chat/completions"),
    ("https://api.example.com/v1", None, "/responses", "https://api.example.com/v1/responses"),
    ("https://api.example.com/v1/responses", None, "/responses", "https://api.example.com/v1/responses"),
    ("http://195.208.3.238:4500", None, "/v1/messages", "http://195.208.3.238:4500/v1/messages"),
    # endpoint_path given as a full URL wins unchanged.
    ("https://api.openai.com/v1", "https://api.example.com/v1/chat/completions", "/chat/completions", "https://api.example.com/v1/chat/completions"),
]

FORMAT_CASES = [
    ("https://api.example.com/v1/chat/completions", None, "openai-chat-completions"),
    ("https://api.example.com/v1/responses", None, "openai-responses"),
    ("https://api.example.com/v1/messages", None, "anthropic-messages"),
    ("https://api.example.com/v1", None, None),
]


def main() -> int:
    failures = 0
    for base_url, endpoint_path, default_path, expected in CASES:
        got = build_request_url(base_url, endpoint_path, default_path)
        status = "OK  " if got == expected else "FAIL"
        if got != expected:
            failures += 1
        print(f"{status} base={base_url!r} ep={endpoint_path!r} default={default_path!r} -> {got!r}")
        if got != expected:
            print(f"      expected: {expected!r}")
    for base_url, endpoint_path, expected in FORMAT_CASES:
        got = infer_format_from_url(base_url, endpoint_path)
        status = "OK  " if got == expected else "FAIL"
        if got != expected:
            failures += 1
        print(f"{status} infer base={base_url!r} ep={endpoint_path!r} -> {got!r}")
        if got != expected:
            print(f"      expected: {expected!r}")
    if failures:
        print(f"\n{failures} failure(s)")
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
