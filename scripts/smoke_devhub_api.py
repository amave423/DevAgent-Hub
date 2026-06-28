from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any

import uvicorn


ROOT_DIR = Path(__file__).resolve().parents[1]
AGENT_API_DIR = ROOT_DIR / 'services' / 'agent-api'
sys.path.insert(0, str(AGENT_API_DIR))


def main() -> int:
    port = int(os.getenv('DEVHUB_API_SMOKE_PORT', '8023'))
    temp_dir = Path(tempfile.mkdtemp(prefix='devhub-api-smoke-'))
    config_path = temp_dir / 'agents.json'
    shutil.copyfile(ROOT_DIR / 'configs' / 'agents.json', config_path)

    os.environ['AGENT_CONFIG_PATH'] = str(config_path)
    os.environ['DEVAGENT_WORKSPACE'] = str(ROOT_DIR)

    from app.main import app

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    server = uvicorn.Server(
        uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning')
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f'http://127.0.0.1:{port}'

    try:
        health = wait_for_json(opener, f'{base_url}/health')
        config = get_json(opener, f'{base_url}/api/agents/config')
        workspace = get_json(opener, f'{base_url}/api/workspace/status')

        assert health['status'] == 'ok'
        assert len(config['models']) > 0
        assert len(config['agents']) > 0
        assert workspace['rootPath'] == str(ROOT_DIR)
        assert 'git' in workspace
        assert 'openVsCode' in workspace
        assert 'github' in workspace

        print('DevHub API smoke: OK')
        print(f"models={len(config['models'])}")
        print(f"agents={len(config['agents'])}")
        print(f"workspace={workspace['rootPath']}")
        print(f"git_repository={workspace['git']['isRepository']}")
        return 0
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        shutil.rmtree(temp_dir, ignore_errors=True)


def wait_for_json(
    opener: urllib.request.OpenerDirector,
    url: str,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for _ in range(100):
        try:
            return get_json(opener, url, timeout=2)
        except Exception as exc:
            last_error = exc
            time.sleep(0.05)
    raise RuntimeError(f'DevHub API smoke server did not start: {last_error}')


def get_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    timeout: float = 5,
) -> dict[str, Any]:
    with opener.open(url, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


if __name__ == '__main__':
    raise SystemExit(main())
