from __future__ import annotations

import json
import os
from pathlib import Path

from .models import AgentsConfig


def default_config_path() -> Path:
    env_path = os.getenv("AGENT_CONFIG_PATH")
    if env_path:
        return Path(env_path)
    return Path(__file__).resolve().parents[3] / "configs" / "agents.json"


class ConfigStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_config_path()

    def load(self) -> AgentsConfig:
        if not self.path.exists():
            raise FileNotFoundError(f"Agents config not found: {self.path}")
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        return AgentsConfig.model_validate(payload)

    def save(self, config: AgentsConfig) -> AgentsConfig:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        normalized = config.model_dump(mode="json")
        self.path.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return config

