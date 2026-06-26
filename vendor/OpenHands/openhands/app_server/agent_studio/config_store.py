from __future__ import annotations

import json
import os
from pathlib import Path

from openhands.app_server.agent_studio.defaults import DEFAULT_AGENT_STUDIO_CONFIG
from openhands.app_server.agent_studio.models import AgentsConfig


def default_config_path() -> Path:
    env_path = os.getenv('AGENT_STUDIO_CONFIG_PATH')
    if env_path:
        return Path(env_path)
    return Path.cwd() / '.openhands' / 'agent-studio' / 'agents.json'


class ConfigStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_config_path()

    def load(self) -> AgentsConfig:
        if not self.path.exists():
            return self.save(AgentsConfig.model_validate(DEFAULT_AGENT_STUDIO_CONFIG))
        payload = json.loads(self.path.read_text(encoding='utf-8'))
        return AgentsConfig.model_validate(payload)

    def save(self, config: AgentsConfig) -> AgentsConfig:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        normalized = config.model_dump(mode='json')
        self.path.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        return config

