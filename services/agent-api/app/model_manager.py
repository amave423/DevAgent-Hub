from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from .config_store import ConfigStore
from .llm import OpenAIProvider
from .workspace_service import read_secret, set_secret
from .models import (
    AddCloudModelRequest,
    AgentModel,
    AgentsConfig,
    CloudModelTestRequest,
    CloudModelTestResponse,
    CloudProviderPreset,
    LocalModelCatalogItem,
    LocalModelSource,
    ModelCatalogResponse,
    ModelDownloadRequest,
    ModelDownloadState,
    ModelFileListResponse,
    ModelKind,
    ModelRequirements,
    ModelSearchResponse,
    TaskStatus,
    utc_now,
)


LOCAL_MODEL_CATALOG = [
    LocalModelCatalogItem(
        id="ollama-qwen25-coder-7b",
        source=LocalModelSource.ollama,
        name="Qwen2.5 Coder 7B",
        provider="ollama",
        modelName="qwen2.5-coder:7b",
        description="Recommended local coding model with a good speed/quality balance.",
        requirements=ModelRequirements(ramGb=8, diskGb=5),
    ),
    LocalModelCatalogItem(
        id="ollama-deepseek-coder-67b",
        source=LocalModelSource.ollama,
        name="DeepSeek Coder 6.7B",
        provider="ollama",
        modelName="deepseek-coder:6.7b",
        description="Strong local model for code generation and edits.",
        requirements=ModelRequirements(ramGb=10, diskGb=6),
    ),
    LocalModelCatalogItem(
        id="ollama-qwen25-coder-14b",
        source=LocalModelSource.ollama,
        name="Qwen2.5 Coder 14B",
        provider="ollama",
        modelName="qwen2.5-coder:14b",
        description="Higher quality local coding model, requires more RAM.",
        requirements=ModelRequirements(ramGb=16, diskGb=9),
    ),
    LocalModelCatalogItem(
        id="ollama-codellama-7b",
        source=LocalModelSource.ollama,
        name="Code Llama 7B",
        provider="ollama",
        modelName="codellama:7b-code",
        description="Code-focused local model from the Code Llama family.",
        requirements=ModelRequirements(ramGb=8, diskGb=4),
    ),
    LocalModelCatalogItem(
        id="ollama-codellama-13b",
        source=LocalModelSource.ollama,
        name="Code Llama 13B",
        provider="ollama",
        modelName="codellama:13b-code",
        description="Larger Code Llama variant for more complex code edits.",
        requirements=ModelRequirements(ramGb=16, diskGb=8),
    ),
    LocalModelCatalogItem(
        id="ollama-llama32-3b",
        source=LocalModelSource.ollama,
        name="Llama 3.2 3B",
        provider="ollama",
        modelName="llama3.2:3b",
        description="Fast local model for short tasks, drafts and plans.",
        requirements=ModelRequirements(ramGb=4, diskGb=3),
    ),
    LocalModelCatalogItem(
        id="ollama-llama31-8b",
        source=LocalModelSource.ollama,
        name="Llama 3.1 8B",
        provider="ollama",
        modelName="llama3.1:8b",
        description="General-purpose local model for planning and text tasks.",
        requirements=ModelRequirements(ramGb=8, diskGb=5),
    ),
    LocalModelCatalogItem(
        id="ollama-mistral-7b",
        source=LocalModelSource.ollama,
        name="Mistral 7B",
        provider="ollama",
        modelName="mistral:7b",
        description="Fast general-purpose local model.",
        requirements=ModelRequirements(ramGb=8, diskGb=4),
    ),
    LocalModelCatalogItem(
        id="ollama-phi4",
        source=LocalModelSource.ollama,
        name="Phi-4",
        provider="ollama",
        modelName="phi4:latest",
        description="Compact reasoning model for lightweight agent steps.",
        requirements=ModelRequirements(ramGb=8, diskGb=6),
    ),
    LocalModelCatalogItem(
        id="huggingface-custom-file",
        source=LocalModelSource.huggingface,
        name="Hugging Face file",
        provider="huggingface-local",
        description="Download a concrete model file from Hugging Face Hub by repo_id and filename.",
        requirements=ModelRequirements(ramGb=0, diskGb=0),
        runnable=False,
    ),
]

OLLAMA_POPULAR_MODELS = [
    "qwen2.5-coder:7b",
    "qwen2.5-coder:14b",
    "qwen2.5-coder:32b",
    "qwen3:8b",
    "qwen3:14b",
    "deepseek-coder:6.7b",
    "deepseek-coder:33b",
    "deepseek-r1:7b",
    "deepseek-r1:14b",
    "llama3.2:3b",
    "llama3.1:8b",
    "llama3.1:70b",
    "codellama:7b-code",
    "codellama:13b-code",
    "codellama:34b-code",
    "mistral:7b",
    "mixtral:8x7b",
    "gemma3:4b",
    "gemma3:12b",
    "phi4:latest",
    "phi4-mini:latest",
    "starcoder2:7b",
    "starcoder2:15b",
    "devstral:latest",
    "granite-code:8b",
    "granite-code:20b",
]


CLOUD_PROVIDER_PRESETS = [
    CloudProviderPreset(
        id="openrouter",
        name="OpenRouter",
        baseUrl="https://openrouter.ai/api/v1",
        apiKeyEnv="AGENT_STUDIO_OPENROUTER_API_KEY",
        description="OpenAI-compatible cloud model router.",
    ),
    CloudProviderPreset(
        id="openai",
        name="OpenAI",
        baseUrl="https://api.openai.com/v1",
        apiKeyEnv="AGENT_STUDIO_OPENAI_API_KEY",
        description="Official OpenAI-compatible API.",
    ),
    CloudProviderPreset(
        id="anthropic",
        name="Anthropic",
        baseUrl="https://api.anthropic.com/v1",
        apiKeyEnv="AGENT_STUDIO_ANTHROPIC_API_KEY",
        description="Anthropic Messages API and compatible proxy endpoints.",
    ),
    CloudProviderPreset(
        id="custom",
        name="Custom / reseller API",
        baseUrl="",
        apiKeyEnv="AGENT_STUDIO_API_KEY",
        description="Any OpenAI-compatible, Responses-compatible, Anthropic-compatible, proxy, reseller or self-hosted endpoint.",
    ),
]


class ModelManager:
    def __init__(self, config_store: ConfigStore, workspace_root: Path) -> None:
        self.config_store = config_store
        self.workspace_root = workspace_root.resolve()
        self.downloads_path = self.workspace_root / ".devagent" / "model-downloads.json"
        self.downloads: dict[str, ModelDownloadState] = self._load_downloads()
        self._workers: dict[str, asyncio.Task[None]] = {}
        self._load_configured_secrets()

    def _load_configured_secrets(self) -> None:
        try:
            config = self.config_store.load()
        except Exception:
            return
        for model in config.models:
            if not model.apiKeyEnv or os.getenv(model.apiKeyEnv):
                continue
            secret = read_secret(self.workspace_root, model.apiKeyEnv)
            if secret:
                os.environ[model.apiKeyEnv] = secret
    def catalog(self) -> ModelCatalogResponse:
        local_models = merge_ollama_installed_models(LOCAL_MODEL_CATALOG, ollama_installed_models())
        return ModelCatalogResponse(
            localSources=[LocalModelSource.ollama, LocalModelSource.huggingface],
            localModels=local_models,
            cloudProviders=CLOUD_PROVIDER_PRESETS,
        )

    def search(self, source: str, query: str, limit: int = 25) -> ModelSearchResponse:
        normalized_source = LocalModelSource(source)
        if normalized_source == LocalModelSource.ollama:
            models = merge_ollama_installed_models(LOCAL_MODEL_CATALOG, ollama_installed_models())
            needle = query.strip().lower()
            if needle:
                local_matches = [
                    model for model in models
                    if needle in model.id.lower()
                    or needle in model.name.lower()
                    or needle in (model.modelName or "").lower()
                ]
                library_matches = ollama_library_search(query, limit)
                models = dedupe_catalog_items([*local_matches, *library_matches], limit)
            else:
                models = dedupe_catalog_items([*models, *ollama_popular_items()], limit)
            return ModelSearchResponse(source=normalized_source, models=models[:limit])

        return ModelSearchResponse(source=normalized_source, models=huggingface_search(query, limit))

    def huggingface_files(self, repo_id: str) -> ModelFileListResponse:
        try:
            from huggingface_hub import HfApi
        except ImportError as exc:
            raise RuntimeError("huggingface_hub is not installed. Re-run installer dependencies.") from exc

        api = HfApi(token=os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN") or None)
        files = api.list_repo_files(repo_id=repo_id, repo_type="model")
        preferred = [
            path for path in files
            if path.lower().endswith((".gguf", ".safetensors", ".bin", ".pt", ".pth"))
        ]
        return ModelFileListResponse(repoId=repo_id, files=preferred or files)

    async def start_download(self, request: ModelDownloadRequest) -> ModelDownloadState:
        item = self._resolve_catalog_item(request)
        download_id = str(uuid.uuid4())
        now = utc_now()
        state = ModelDownloadState(
            downloadId=download_id,
            modelId=item.id,
            source=item.source,
            status=TaskStatus.queued,
            progress=0,
            message="Download queued.",
            modelName=request.modelName or item.modelName or item.name,
            repoId=request.repoId or item.repoId,
            filename=request.filename or item.filename,
            displayName=request.displayName,
            createdAt=now,
            updatedAt=now,
        )
        self.downloads[download_id] = state
        self._persist_downloads()
        self._workers[download_id] = asyncio.create_task(self._run_download(download_id, item, request))
        return state

    def list_downloads(self) -> list[ModelDownloadState]:
        return sorted(self.downloads.values(), key=lambda item: item.createdAt, reverse=True)

    def get_download(self, download_id: str) -> ModelDownloadState | None:
        return self.downloads.get(download_id)

    async def retry_download(self, download_id: str) -> ModelDownloadState:
        current = self.downloads.get(download_id)
        if current is None:
            raise KeyError("Model download not found")
        return await self.start_download(
            ModelDownloadRequest(
                modelId=current.modelId,
                source=current.source,
                modelName=current.modelName,
                repoId=current.repoId,
                filename=current.filename,
                displayName=current.displayName,
            )
        )

    async def delete_local_model(self, source: str, model_ref: str) -> AgentsConfig:
        normalized_source = LocalModelSource(source)
        decoded_ref = urllib.parse.unquote(model_ref)
        if normalized_source == LocalModelSource.ollama:
            return await self._delete_ollama_model(decoded_ref)
        if normalized_source == LocalModelSource.huggingface:
            return self._delete_huggingface_model(decoded_ref)
        raise ValueError(f"Unsupported local model source: {source}")

    def delete_cloud_model(self, model_ref: str) -> AgentsConfig:
        decoded_ref = urllib.parse.unquote(model_ref)

        def matches(model: AgentModel) -> bool:
            return (
                model.kind == ModelKind.cloud
                and (
                    model.id == decoded_ref
                    or model.name == decoded_ref
                    or (model.modelName or "") == decoded_ref
                )
            )

        return self._remove_models(matches)

    def delete_all_cloud_models(self) -> AgentsConfig:
        return self._remove_models(lambda model: model.kind == ModelKind.cloud)

    def add_cloud_model(self, request: AddCloudModelRequest) -> AgentsConfig:
        provider = slugify(request.provider or "custom") or "custom"
        model_id = slugify(request.id or f"{provider}-{request.name}")
        api_key_env = (request.apiKeyEnv or default_api_key_env(provider)).strip()
        base_url = (request.baseUrl or "").strip() or None
        api_format = request.apiFormat or default_api_format(provider)
        endpoint_path = (request.endpointPath or "").strip() or None

        if request.apiKey and api_key_env:
            api_key = request.apiKey.strip()
            os.environ[api_key_env] = api_key
            set_secret(self.workspace_root, api_key_env, api_key)

        model = AgentModel(
            id=model_id,
            name=request.name.strip(),
            provider=provider,
            kind=ModelKind.cloud,
            modelName=(request.modelName or request.name).strip(),
            baseUrl=base_url,
            apiKeyEnv=api_key_env,
            apiFormat=api_format,
            endpointPath=endpoint_path,
            description=request.description or f"Custom cloud model via {provider}.",
            requirements=ModelRequirements(ramGb=1, diskGb=0),
        )
        return self._save_model(model)

    async def test_cloud_model(self, request: CloudModelTestRequest) -> CloudModelTestResponse:
        provider = request.provider.strip() or "custom"
        api_key_env = (request.apiKeyEnv or default_api_key_env(provider)).strip()
        api_key = (request.apiKey or "").strip() or (os.getenv(api_key_env) if api_key_env else "") or ""
        base_url = (request.baseUrl or "").strip() or provider_base_url(provider) or None
        client = OpenAIProvider(
            api_key=api_key,
            base_url=base_url,
            provider_id=provider,
            api_format=request.apiFormat or default_api_format(provider),
            endpoint_path=(request.endpointPath or "").strip() or None,
        )
        result = await client.chat(
            model=(request.modelName or request.name).strip(),
            messages=[
                {"role": "system", "content": "Reply with a short health check."},
                {"role": "user", "content": "Say OK if this model endpoint is reachable."},
            ],
            temperature=0,
            max_tokens=64,
        )
        return CloudModelTestResponse(
            ok=True,
            message="Cloud model test succeeded.",
            output=result.text[:1000],
            result=result,
        )

    async def _run_download(
        self,
        download_id: str,
        item: LocalModelCatalogItem,
        request: ModelDownloadRequest,
    ) -> None:
        try:
            self._update(download_id, status=TaskStatus.running, progress=3, message="Download started.")
            if item.source == LocalModelSource.ollama:
                model = await self._download_ollama(download_id, item)
            elif item.source == LocalModelSource.huggingface:
                model = await self._download_huggingface(download_id, item, request)
            else:
                raise RuntimeError(f"Unsupported local model source: {item.source}")

            self._save_model(model)
            self._update(
                download_id,
                status=TaskStatus.completed,
                progress=100,
                message="Model downloaded and added to settings.",
                model=model,
            )
        except Exception as exc:
            current = self.downloads[download_id]
            self._update(
                download_id,
                status=TaskStatus.failed,
                progress=current.progress,
                message=str(exc),
            )

    async def _download_ollama(self, download_id: str, item: LocalModelCatalogItem) -> AgentModel:
        command = find_ollama_command()
        if not command:
            command = await self._install_ollama(download_id)

        model_name = item.modelName or item.name
        process = await asyncio.create_subprocess_exec(
            command,
            "pull",
            model_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        assert process.stdout is not None
        while True:
            raw_line = await process.stdout.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="replace").strip()
            percent = parse_percent(line)
            current = self.downloads[download_id].progress
            progress = max(5, min(98, percent if percent is not None else current))
            self._update(download_id, progress=progress, message=line or f"Downloading {model_name}...")

        code = await process.wait()
        if code != 0:
            raise RuntimeError(f"ollama pull {model_name} exited with code {code}.")

        return AgentModel(
            id=item.id,
            name=model_name,
            provider="ollama",
            kind=ModelKind.local,
            modelName=model_name,
            baseUrl=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            description=item.description,
            requirements=item.requirements,
        )

    async def _install_ollama(self, download_id: str) -> str:
        self._update(download_id, progress=5, message="Ollama is not installed. Installing Ollama runtime...")
        if os.name == "nt":
            winget = shutil.which("winget")
            if not winget:
                raise RuntimeError("Ollama is required for Ollama models, but winget was not found.")
            result = await asyncio.to_thread(
                subprocess.run,
                [
                    winget,
                    "install",
                    "-e",
                    "--id",
                    "Ollama.Ollama",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=1800,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Ollama installer failed.")
        else:
            curl = shutil.which("curl")
            shell = shutil.which("sh")
            if not curl or not shell:
                raise RuntimeError("Ollama is required, but curl/sh was not found.")
            result = await asyncio.to_thread(
                subprocess.run,
                [shell, "-c", "curl -fsSL https://ollama.com/install.sh | sh"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=1800,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Ollama installer failed.")

        command = find_ollama_command()
        if not command:
            raise RuntimeError("Ollama installed, but the executable was not found. Restart Orqen Studio and try again.")
        self._update(download_id, progress=15, message="Ollama runtime installed. Pulling selected model...")
        return command

    async def _download_huggingface(
        self,
        download_id: str,
        item: LocalModelCatalogItem,
        request: ModelDownloadRequest,
    ) -> AgentModel:
        repo_id = (request.repoId or item.repoId or "").strip()
        filename = (request.filename or item.filename or "").strip()
        if not repo_id or not filename:
            raise RuntimeError("For Hugging Face, provide both repo_id and filename.")

        try:
            from huggingface_hub import hf_hub_download
        except ImportError as exc:
            raise RuntimeError("huggingface_hub is not installed. Re-run installer dependencies.") from exc

        target_dir = self.workspace_root / ".models" / "huggingface"
        target_dir.mkdir(parents=True, exist_ok=True)
        done = asyncio.Event()

        async def tick() -> None:
            while not done.is_set():
                current = self.downloads[download_id].progress
                self._update(
                    download_id,
                    progress=min(95, max(10, current + 3)),
                    message=f"Downloading {repo_id}/{filename} from Hugging Face...",
                )
                await asyncio.sleep(1.0)

        ticker = asyncio.create_task(tick())
        try:
            local_path = await asyncio.to_thread(
                hf_hub_download,
                repo_id=repo_id,
                filename=filename,
                local_dir=target_dir / slugify(repo_id.replace("/", "-")),
                token=os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN") or None,
            )
        finally:
            done.set()
            await ticker

        display_name = (request.displayName or Path(filename).stem).strip()
        model_id = slugify(f"hf-{repo_id}-{filename}")
        return AgentModel(
            id=model_id,
            name=display_name,
            provider="huggingface-local",
            kind=ModelKind.local,
            modelName=display_name,
            baseUrl=str(local_path),
            description="Model file downloaded from Hugging Face Hub. A local runtime integration is required to run it.",
            requirements=item.requirements,
        )

    async def _delete_ollama_model(self, model_ref: str) -> AgentsConfig:
        model_name = self._resolve_ollama_model_name(model_ref)
        command = find_ollama_command()
        if not command:
            raise RuntimeError("Ollama executable was not found.")
        result = await asyncio.to_thread(
            subprocess.run,
            [command, "rm", model_name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Could not delete {model_name}.")
        return self._remove_models(lambda model: model.provider == "ollama" and (model.id == model_ref or model.name == model_name))

    def _delete_huggingface_model(self, model_ref: str) -> AgentsConfig:
        config = self.config_store.load()
        model = next(
            (
                item for item in config.models
                if item.provider == "huggingface-local" and (item.id == model_ref or item.name == model_ref)
            ),
            None,
        )
        if not model:
            raise RuntimeError("Hugging Face model was not found in config.")
        base_dir = (self.workspace_root / ".models" / "huggingface").resolve()
        target = Path(model.baseUrl or "").resolve()
        try:
            target.relative_to(base_dir)
        except ValueError as exc:
            raise RuntimeError("Refusing to delete a file outside .models/huggingface.") from exc
        if target.is_file():
            target.unlink()
        cleanup_empty_parents(target.parent, base_dir)
        return self._remove_models(lambda item: item.id == model.id)

    def _resolve_ollama_model_name(self, model_ref: str) -> str:
        config = self.config_store.load()
        model = next(
            (
                item for item in config.models
                if item.provider == "ollama" and (item.id == model_ref or item.name == model_ref)
            ),
            None,
        )
        if model:
            return model.name
        catalog_item = next(
            (
                item for item in self.catalog().localModels
                if item.id == model_ref or item.name == model_ref or item.modelName == model_ref
            ),
            None,
        )
        return catalog_item.modelName if catalog_item and catalog_item.modelName else model_ref

    def _resolve_catalog_item(self, request: ModelDownloadRequest) -> LocalModelCatalogItem:
        if request.source == LocalModelSource.ollama and request.modelName:
            return ollama_custom_item(request.modelName)
        for item in LOCAL_MODEL_CATALOG:
            if item.id == request.modelId and (request.source is None or request.source == item.source):
                return item
        if request.source == LocalModelSource.huggingface:
            return LOCAL_MODEL_CATALOG[-1]
        raise ValueError(f"Unknown local model id: {request.modelId}")

    def _save_model(self, model: AgentModel) -> AgentsConfig:
        config = self.config_store.load()
        models = [current for current in config.models if current.id != model.id]
        models.append(model)
        return self.config_store.save(config.model_copy(update={"models": models}))

    def _remove_models(self, predicate) -> AgentsConfig:
        config = self.config_store.load()
        removed_ids = {current.id for current in config.models if predicate(current)}
        models = [current for current in config.models if not predicate(current)]
        fallback_model_id = models[0].id if models else ""
        agents = [
            agent.model_copy(update={"modelId": fallback_model_id})
            if agent.modelId in removed_ids and fallback_model_id
            else agent
            for agent in config.agents
        ]
        return self.config_store.save(config.model_copy(update={"models": models, "agents": agents}))

    def _update(self, download_id: str, **patch: object) -> None:
        current = self.downloads[download_id]
        self.downloads[download_id] = current.model_copy(update={**patch, "updatedAt": utc_now()})
        self._persist_downloads()

    def _load_downloads(self) -> dict[str, ModelDownloadState]:
        if not self.downloads_path.exists():
            return {}
        try:
            payload = json.loads(self.downloads_path.read_text(encoding="utf-8"))
            states = [ModelDownloadState.model_validate(item) for item in payload]
        except Exception:
            return {}
        downloads = {}
        for state in states:
            if state.status in {TaskStatus.queued, TaskStatus.running}:
                state = state.model_copy(
                    update={
                        "status": TaskStatus.failed,
                        "message": "Download was interrupted because the service restarted. Use retry.",
                        "updatedAt": utc_now(),
                    }
                )
            downloads[state.downloadId] = state
        return downloads

    def _persist_downloads(self) -> None:
        self.downloads_path.parent.mkdir(parents=True, exist_ok=True)
        payload = [state.model_dump(mode="json") for state in self.list_downloads()]
        tmp_path = self.downloads_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self.downloads_path)


def find_ollama_command() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found

    if os.name != "nt":
        return None

    candidates = [
        os.getenv("OLLAMA_COMMAND"),
        str(Path(os.getenv("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"),
        str(Path(os.getenv("ProgramFiles", "")) / "Ollama" / "ollama.exe"),
    ]
    return next((candidate for candidate in candidates if candidate and Path(candidate).exists()), None)


def ollama_installed_models() -> list[LocalModelCatalogItem]:
    try:
        request = urllib.request.Request("http://127.0.0.1:11434/api/tags", method="GET")
        with urllib.request.urlopen(request, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        return []

    items = []
    for model in payload.get("models", []):
        name = str(model.get("name") or model.get("model") or "").strip()
        if not name:
            continue
        items.append(
            LocalModelCatalogItem(
                id=f"ollama-{slugify(name)}",
                source=LocalModelSource.ollama,
                name=name,
                provider="ollama",
                modelName=name,
                description="Installed Ollama model.",
                requirements=ModelRequirements(ramGb=0, diskGb=0),
                installed=True,
                sizeBytes=int(model.get("size") or 0) or None,
                details=str(model.get("details") or ""),
            )
        )
    return items


def merge_ollama_installed_models(
    recommended: list[LocalModelCatalogItem],
    installed: list[LocalModelCatalogItem],
) -> list[LocalModelCatalogItem]:
    by_name = {model.modelName or model.name: model for model in installed}
    merged = []
    for model in recommended:
        installed_model = by_name.get(model.modelName or model.name)
        merged.append(
            model.model_copy(update={
                "installed": bool(installed_model),
                "sizeBytes": installed_model.sizeBytes if installed_model else model.sizeBytes,
                "details": installed_model.details if installed_model else model.details,
            })
        )
    known_names = {model.modelName or model.name for model in recommended}
    merged.extend(model for model in installed if (model.modelName or model.name) not in known_names)
    return merged


def ollama_custom_item(model_name: str) -> LocalModelCatalogItem:
    clean_name = model_name.strip()
    return LocalModelCatalogItem(
        id=f"ollama-{slugify(clean_name)}",
        source=LocalModelSource.ollama,
        name=clean_name,
        provider="ollama",
        modelName=clean_name,
        description="Custom Ollama model name. Orqen Studio will run `ollama pull` for it.",
        requirements=ModelRequirements(ramGb=0, diskGb=0),
    )


def ollama_popular_items() -> list[LocalModelCatalogItem]:
    return [ollama_custom_item(model_name) for model_name in OLLAMA_POPULAR_MODELS]


def ollama_library_search(query: str, limit: int) -> list[LocalModelCatalogItem]:
    needle = query.strip()
    if not needle:
        return ollama_popular_items()[:limit]
    try:
        encoded = urllib.parse.urlencode({"q": needle})
        request = urllib.request.Request(
            f"https://ollama.com/search?{encoded}",
            headers={"User-Agent": "Orqen-Studio"},
            method="GET",
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            html = response.read().decode("utf-8", errors="replace")
    except Exception:
        return [
            item for item in ollama_popular_items()
            if needle.lower() in item.name.lower() or needle.lower() in (item.modelName or "").lower()
        ][:limit]

    names: list[str] = []
    for match in re.finditer(r'href="/library/([^"/?#]+)', html):
        name = urllib.parse.unquote(match.group(1)).strip()
        if name and name not in names:
            names.append(name)
    return [ollama_custom_item(name) for name in names[:limit]]


def dedupe_catalog_items(items: list[LocalModelCatalogItem], limit: int) -> list[LocalModelCatalogItem]:
    seen: set[str] = set()
    result = []
    for item in items:
        key = (item.modelName or item.name or item.id).lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
        if len(result) >= limit:
            break
    return result


def huggingface_search(query: str, limit: int) -> list[LocalModelCatalogItem]:
    try:
        from huggingface_hub import HfApi
    except ImportError as exc:
        raise RuntimeError("huggingface_hub is not installed. Re-run installer dependencies.") from exc

    api = HfApi(token=os.getenv("HUGGINGFACE_TOKEN") or os.getenv("HF_TOKEN") or None)
    search = query.strip() or "gguf"
    results = api.list_models(search=search, limit=limit)
    items: list[LocalModelCatalogItem] = []
    for model in results:
        repo_id = str(getattr(model, "modelId", "") or "").strip()
        if not repo_id:
            continue
        downloads = getattr(model, "downloads", None)
        likes = getattr(model, "likes", None)
        items.append(
            LocalModelCatalogItem(
                id=f"huggingface-{slugify(repo_id)}",
                source=LocalModelSource.huggingface,
                name=repo_id,
                provider="huggingface-local",
                repoId=repo_id,
                description=f"Hugging Face model repo. downloads={downloads or 0}, likes={likes or 0}",
                requirements=ModelRequirements(ramGb=0, diskGb=0),
                runnable=False,
            )
        )
    return items


def parse_percent(line: str) -> int | None:
    match = re.search(r"(\d{1,3})%", line)
    if not match:
        return None
    return max(0, min(100, int(match.group(1))))


def slugify(value: str) -> str:
    text = value.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "model"


def default_api_key_env(provider: str) -> str:
    if provider == "openai":
        return "AGENT_STUDIO_OPENAI_API_KEY"
    if provider == "openrouter":
        return "AGENT_STUDIO_OPENROUTER_API_KEY"
    if provider == "anthropic":
        return "AGENT_STUDIO_ANTHROPIC_API_KEY"
    return "AGENT_STUDIO_API_KEY"


def provider_base_url(provider: str) -> str:
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "openrouter":
        return "https://openrouter.ai/api/v1"
    if provider == "anthropic":
        return "https://api.anthropic.com/v1"
    return ""


def default_api_format(provider: str) -> str:
    return "auto"


def cleanup_empty_parents(start: Path, stop: Path) -> None:
    current = start.resolve()
    stop = stop.resolve()
    while current != stop:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent
