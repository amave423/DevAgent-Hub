from __future__ import annotations

import asyncio
import os
import re
import shutil
import uuid
from pathlib import Path

from .config_store import ConfigStore
from .models import (
    AddCloudModelRequest,
    AgentModel,
    AgentsConfig,
    CloudProviderPreset,
    LocalModelCatalogItem,
    LocalModelSource,
    ModelCatalogResponse,
    ModelDownloadRequest,
    ModelDownloadState,
    ModelKind,
    ModelRequirements,
    TaskStatus,
)


LOCAL_MODEL_CATALOG = [
    LocalModelCatalogItem(
        id="ollama-qwen25-coder-7b",
        source=LocalModelSource.ollama,
        name="Qwen2.5 Coder 7B",
        provider="ollama",
        modelName="qwen2.5-coder:7b",
        description="Сильная локальная модель для кода с умеренными требованиями к железу.",
        requirements=ModelRequirements(ramGb=8, diskGb=5),
    ),
    LocalModelCatalogItem(
        id="ollama-deepseek-coder-67b",
        source=LocalModelSource.ollama,
        name="DeepSeek Coder 6.7B",
        provider="ollama",
        modelName="deepseek-coder:6.7b",
        description="Хороший локальный вариант для генерации и исправления кода.",
        requirements=ModelRequirements(ramGb=10, diskGb=6),
    ),
    LocalModelCatalogItem(
        id="ollama-llama32-3b",
        source=LocalModelSource.ollama,
        name="Llama 3.2 3B",
        provider="ollama",
        modelName="llama3.2:3b",
        description="Быстрая лёгкая модель для коротких задач, планов и черновиков.",
        requirements=ModelRequirements(ramGb=4, diskGb=3),
    ),
    LocalModelCatalogItem(
        id="huggingface-custom-file",
        source=LocalModelSource.huggingface,
        name="Hugging Face file",
        provider="huggingface-local",
        description="Скачивание конкретного файла модели из Hugging Face Hub по repo_id и filename.",
        requirements=ModelRequirements(ramGb=0, diskGb=0),
        runnable=False,
    ),
]


CLOUD_PROVIDER_PRESETS = [
    CloudProviderPreset(
        id="openrouter",
        name="OpenRouter",
        baseUrl="https://openrouter.ai/api/v1",
        apiKeyEnv="AGENT_STUDIO_OPENROUTER_API_KEY",
        description="OpenAI-compatible маршрутизатор облачных моделей.",
    ),
    CloudProviderPreset(
        id="openai",
        name="OpenAI",
        baseUrl="https://api.openai.com/v1",
        apiKeyEnv="AGENT_STUDIO_OPENAI_API_KEY",
        description="Официальный OpenAI-compatible API.",
    ),
    CloudProviderPreset(
        id="custom",
        name="Custom OpenAI-compatible",
        baseUrl="",
        apiKeyEnv="AGENT_STUDIO_API_KEY",
        description="Любой совместимый API: свой proxy, reseller или self-hosted endpoint.",
    ),
]


class ModelManager:
    def __init__(self, config_store: ConfigStore, workspace_root: Path) -> None:
        self.config_store = config_store
        self.workspace_root = workspace_root
        self.downloads: dict[str, ModelDownloadState] = {}
        self._workers: dict[str, asyncio.Task[None]] = {}

    def catalog(self) -> ModelCatalogResponse:
        return ModelCatalogResponse(
            localSources=[LocalModelSource.ollama, LocalModelSource.huggingface],
            localModels=LOCAL_MODEL_CATALOG,
            cloudProviders=CLOUD_PROVIDER_PRESETS,
        )

    async def start_download(self, request: ModelDownloadRequest) -> ModelDownloadState:
        item = self._resolve_catalog_item(request)
        download_id = str(uuid.uuid4())
        state = ModelDownloadState(
            downloadId=download_id,
            modelId=item.id,
            source=item.source,
            status=TaskStatus.queued,
            progress=0,
            message="Загрузка поставлена в очередь.",
        )
        self.downloads[download_id] = state
        self._workers[download_id] = asyncio.create_task(self._run_download(download_id, item, request))
        return state

    def get_download(self, download_id: str) -> ModelDownloadState | None:
        return self.downloads.get(download_id)

    def add_cloud_model(self, request: AddCloudModelRequest) -> AgentsConfig:
        provider = slugify(request.provider or "custom") or "custom"
        model_id = slugify(request.id or f"{provider}-{request.name}")
        api_key_env = (request.apiKeyEnv or default_api_key_env(provider)).strip()
        base_url = (request.baseUrl or "").strip() or None

        if request.apiKey and api_key_env:
            os.environ[api_key_env] = request.apiKey.strip()

        model = AgentModel(
            id=model_id,
            name=request.name.strip(),
            provider=provider,
            kind=ModelKind.cloud,
            baseUrl=base_url,
            apiKeyEnv=api_key_env,
            description=request.description or f"Custom cloud model via {provider}.",
            requirements=ModelRequirements(ramGb=1, diskGb=0),
        )
        return self._save_model(model)

    async def _run_download(
        self,
        download_id: str,
        item: LocalModelCatalogItem,
        request: ModelDownloadRequest,
    ) -> None:
        try:
            self._update(download_id, status=TaskStatus.running, progress=3, message="Загрузка началась.")
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
                message="Модель скачана и добавлена в настройки.",
                model=model,
            )
        except Exception as exc:
            self._update(
                download_id,
                status=TaskStatus.failed,
                progress=self.downloads[download_id].progress,
                message=str(exc),
            )

    async def _download_ollama(self, download_id: str, item: LocalModelCatalogItem) -> AgentModel:
        command = find_ollama_command()
        if not command:
            raise RuntimeError("Ollama не найден. Установи Ollama или выбери другой источник локальных моделей.")

        model_name = item.modelName or item.name
        process = await asyncio.create_subprocess_exec(
            command,
            "pull",
            model_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        while True:
            assert process.stdout is not None
            raw_line = await process.stdout.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="replace").strip()
            percent = parse_percent(line)
            progress = max(5, min(98, percent if percent is not None else self.downloads[download_id].progress))
            self._update(download_id, progress=progress, message=line or f"Скачивание {model_name}...")

        code = await process.wait()
        if code != 0:
            raise RuntimeError(f"ollama pull {model_name} завершился с кодом {code}.")

        return AgentModel(
            id=item.id,
            name=model_name,
            provider="ollama",
            kind=ModelKind.local,
            baseUrl=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            description=item.description,
            requirements=item.requirements,
        )

    async def _download_huggingface(
        self,
        download_id: str,
        item: LocalModelCatalogItem,
        request: ModelDownloadRequest,
    ) -> AgentModel:
        repo_id = (request.repoId or item.repoId or "").strip()
        filename = (request.filename or item.filename or "").strip()
        if not repo_id or not filename:
            raise RuntimeError("Для Hugging Face укажи repo_id и filename конкретного файла модели.")

        try:
            from huggingface_hub import hf_hub_download
        except ImportError as exc:
            raise RuntimeError(
                "Python-пакет huggingface_hub не установлен. Запусти установку зависимостей или повтори install.ps1.",
            ) from exc

        target_dir = self.workspace_root / ".models" / "huggingface"
        target_dir.mkdir(parents=True, exist_ok=True)
        done = asyncio.Event()

        async def tick() -> None:
            while not done.is_set():
                current = self.downloads[download_id].progress
                self._update(
                    download_id,
                    progress=min(95, max(10, current + 3)),
                    message=f"Скачивание {repo_id}/{filename} из Hugging Face...",
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
            baseUrl=str(local_path),
            description="Файл модели скачан из Hugging Face Hub. Для выполнения нужен подключенный локальный runtime.",
            requirements=item.requirements,
        )

    def _resolve_catalog_item(self, request: ModelDownloadRequest) -> LocalModelCatalogItem:
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

    def _update(self, download_id: str, **patch: object) -> None:
        current = self.downloads[download_id]
        self.downloads[download_id] = current.model_copy(update=patch)


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


def parse_percent(line: str) -> int | None:
    match = re.search(r"(\d{1,3})%", line)
    if not match:
        return None
    return min(100, max(0, int(match.group(1))))


def default_api_key_env(provider: str) -> str:
    if provider == "openai":
        return "AGENT_STUDIO_OPENAI_API_KEY"
    if provider == "openrouter":
        return "AGENT_STUDIO_OPENROUTER_API_KEY"
    return "AGENT_STUDIO_API_KEY"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower()).strip("-._")
    return slug or "custom-model"
