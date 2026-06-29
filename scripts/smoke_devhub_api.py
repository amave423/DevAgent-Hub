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
    source_config = Path(os.getenv('AGENT_CONFIG_PATH', ROOT_DIR / 'configs' / 'agents.json'))
    workspace_root = Path(os.getenv('DEVAGENT_WORKSPACE', ROOT_DIR)).resolve()
    shutil.copyfile(source_config, config_path)

    os.environ['AGENT_CONFIG_PATH'] = str(config_path)
    os.environ['DEVAGENT_WORKSPACE'] = str(workspace_root)

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
        config['runtime']['runnerMode'] = 'mock'
        config = post_json(opener, f'{base_url}/api/agents/config', config)
        catalog = get_json(opener, f'{base_url}/api/models/catalog')
        workspace = get_json(opener, f'{base_url}/api/workspace/status')
        chat = post_json(opener, f'{base_url}/api/chats', {'title': 'Smoke chat'})
        run = post_json(opener, f"{base_url}/api/chats/{chat['id']}/run", {
            'content': 'Say hello from the smoke test.',
            'attachmentIds': [],
            'agentIds': [config['agents'][0]['id']],
            'webSearch': False,
        })
        task = wait_for_task(opener, base_url, run['taskId'])
        saved_chat = get_json(opener, f"{base_url}/api/chats/{chat['id']}")

        assert health['status'] == 'ok'
        assert len(config['models']) > 0
        assert len(config['agents']) > 0
        assert len(catalog['localModels']) > 0
        assert len(catalog['cloudProviders']) > 0
        assert workspace['rootPath'] == str(workspace_root)
        assert 'git' in workspace
        assert 'openVsCode' in workspace
        assert 'github' in workspace
        assert task['status'] == 'completed'
        assert len(task['llmCalls']) >= 1
        assert task['llmCalls'][0]['provider'] == 'mock'
        assert [message['role'] for message in saved_chat['messages']][-2:] == ['user', 'assistant']

        if os.getenv('SERVE_FRONTEND', '').lower() in {'1', 'true', 'yes'}:
            html = get_text(opener, f'{base_url}/')
            assert '<div id="root">' in html

        print('DevHub API smoke: OK')
        print(f"models={len(config['models'])}")
        print(f"agents={len(config['agents'])}")
        print(f"catalog_local_models={len(catalog['localModels'])}")
        print(f"chat_messages={len(saved_chat['messages'])}")
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


def post_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    payload: dict[str, Any],
    timeout: float = 5,
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with opener.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def wait_for_task(
    opener: urllib.request.OpenerDirector,
    base_url: str,
    task_id: str,
) -> dict[str, Any]:
    for _ in range(100):
        task = get_json(opener, f'{base_url}/api/agents/status/{task_id}', timeout=2)
        if task['status'] in {'completed', 'failed', 'cancelled'}:
            return task
        time.sleep(0.05)
    raise RuntimeError(f'Task did not finish: {task_id}')


def get_text(
    opener: urllib.request.OpenerDirector,
    url: str,
    timeout: float = 5,
) -> str:
    with opener.open(url, timeout=timeout) as response:
        return response.read().decode('utf-8')


if __name__ == '__main__':
    raise SystemExit(main())
