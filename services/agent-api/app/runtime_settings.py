from __future__ import annotations

import json
import os
import socket
import uuid
from pathlib import Path

from .models import PendingAction, RuntimeSettings, SaveRuntimeSettingsRequest


class RuntimeSettingsStore:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()
        self.path = self.workspace_root / ".devagent" / "runtime.json"

    def load(self) -> RuntimeSettings:
        defaults = self._defaults()
        if not self.path.exists():
            return defaults
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            saved = RuntimeSettings.model_validate({**defaults.model_dump(), **payload})
        except Exception:
            return defaults
        return saved.model_copy(update=self._environment_patch())

    def save(self, request: SaveRuntimeSettingsRequest) -> RuntimeSettings:
        current = self.load()
        patch = request.model_dump(exclude_none=True)
        saved = current.model_copy(update=patch)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        persisted = saved.model_dump(mode="json")
        persisted.pop("authRequired", None)
        persisted.pop("authTokenConfigured", None)
        persisted.pop("urls", None)
        self.path.write_text(json.dumps(persisted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return self.load()

    def _defaults(self) -> RuntimeSettings:
        return RuntimeSettings(**self._environment_patch())

    def _environment_patch(self) -> dict[str, object]:
        host = os.getenv("DEVAGENT_HOST", "127.0.0.1")
        port = int(os.getenv("DEVAGENT_PORT", "3000") or "3000")
        external = os.getenv("DEVAGENT_EXTERNAL_ACCESS", "").lower() in {"1", "true", "yes"}
        token_configured = bool(os.getenv("DEVAGENT_AUTH_TOKEN"))
        urls = [f"http://127.0.0.1:{port}"]
        if external:
            urls.extend(f"http://{ip}:{port}" for ip in lan_ipv4_addresses())
        patch = {
            "externalAccess": external,
            "host": host,
            "port": port,
            "authRequired": token_configured,
            "authTokenConfigured": token_configured,
            "urls": urls,
        }
        searxng_url = os.getenv("DEVAGENT_SEARXNG_URL", "").strip()
        if searxng_url:
            patch["webSearchEnabled"] = True
            patch["webSearchBaseUrl"] = searxng_url
        return patch


class ActionRegistry:
    def __init__(self) -> None:
        self._actions: dict[str, PendingAction] = {}

    def list(self) -> list[PendingAction]:
        return sorted(self._actions.values(), key=lambda item: item.createdAt, reverse=True)

    def create(self, *, title: str, description: str, kind: str) -> PendingAction:
        action = PendingAction(
            id=str(uuid.uuid4()),
            title=title,
            description=description,
            kind=kind,  # type: ignore[arg-type]
        )
        self._actions[action.id] = action
        return action

    def approve(self, action_id: str) -> PendingAction:
        return self._set_status(action_id, "approved")

    def reject(self, action_id: str) -> PendingAction:
        return self._set_status(action_id, "rejected")

    def _set_status(self, action_id: str, status: str) -> PendingAction:
        action = self._actions.get(action_id)
        if action is None:
            raise KeyError("Action not found")
        action = action.model_copy(update={"status": status})
        self._actions[action_id] = action
        return action


def lan_ipv4_addresses() -> list[str]:
    addresses: set[str] = set()
    hostname = socket.gethostname()
    try:
        for result in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = result[4][0]
            if not ip.startswith("127."):
                addresses.add(ip)
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            ip = probe.getsockname()[0]
            if not ip.startswith("127."):
                addresses.add(ip)
    except OSError:
        pass

    return sorted(addresses)
