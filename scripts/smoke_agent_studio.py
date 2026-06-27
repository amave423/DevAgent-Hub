from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI


ROOT_DIR = Path(__file__).resolve().parents[1]
OPENHANDS_DIR = ROOT_DIR / 'vendor' / 'OpenHands'
sys.path.insert(0, str(OPENHANDS_DIR))


TERMINAL_STATUSES = {'completed', 'failed', 'cancelled'}


def main() -> int:
    port = int(os.getenv('AGENT_STUDIO_SMOKE_PORT', '8021'))
    config_path = Path(tempfile.gettempdir()) / 'devagent-agent-studio-smoke.json'
    os.environ['AGENT_STUDIO_CONFIG_PATH'] = str(config_path)

    from openhands.app_server.agent_studio.router import router

    app = FastAPI()
    app.include_router(router, prefix='/api/v1')

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    server = uvicorn.Server(
        uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning')
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f'http://127.0.0.1:{port}/api/v1/agents'

    try:
        config = wait_for_config(opener, base_url)
        config['runtime']['runnerMode'] = 'mock'
        saved = post_json(opener, f'{base_url}/config', config)
        run_response = post_json(opener, f'{base_url}/run', {'task': 'HTTP smoke test'})
        final_state = wait_for_terminal_state(
            opener,
            f"{base_url}/status/{run_response['taskId']}",
        )
        logs_payload = get_text(opener, f"{base_url}/logs/{run_response['taskId']}")
        cancel_response = post_json(
            opener,
            f"{base_url}/cancel/{run_response['taskId']}",
            {},
        )

        assert len(saved['models']) > 0
        assert run_response['status'] == 'queued'
        assert final_state['status'] == 'completed'
        assert final_state['progress'] == 100
        assert final_state.get('result')
        assert 'event: done' in logs_payload
        assert cancel_response['status'] == 'completed'

        print('Agent Studio smoke: OK')
        print(f"models={len(saved['models'])}")
        print(f"task={run_response['taskId']}")
        print(f"status={final_state['status']} progress={final_state['progress']}")
        return 0
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        try:
            config_path.unlink()
        except OSError:
            pass


def wait_for_config(
    opener: urllib.request.OpenerDirector,
    base_url: str,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for _ in range(100):
        try:
            return get_json(opener, f'{base_url}/config', timeout=2)
        except Exception as exc:
            last_error = exc
            time.sleep(0.05)
    raise RuntimeError(f'Agent Studio smoke server did not start: {last_error}')


def wait_for_terminal_state(
    opener: urllib.request.OpenerDirector,
    status_url: str,
) -> dict[str, Any]:
    state: dict[str, Any] | None = None
    for _ in range(100):
        state = get_json(opener, status_url)
        if state['status'] in TERMINAL_STATUSES:
            return state
        time.sleep(0.05)
    raise RuntimeError(f'Agent Studio task did not finish: {state}')


def get_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    timeout: float = 5,
) -> dict[str, Any]:
    with opener.open(url, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def get_text(
    opener: urllib.request.OpenerDirector,
    url: str,
    timeout: float = 10,
) -> str:
    with opener.open(url, timeout=timeout) as response:
        return response.read().decode('utf-8')


def post_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with opener.open(request, timeout=5) as response:
        return json.loads(response.read().decode('utf-8'))


if __name__ == '__main__':
    raise SystemExit(main())
