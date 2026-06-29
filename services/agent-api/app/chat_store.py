from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Iterable

from .models import (
    AgentLogEvent,
    ChatAttachment,
    ChatMessage,
    ChatSession,
    ChatSummary,
    LLMCallResult,
    TaskState,
    TaskStatus,
    utc_now,
)


class ChatStore:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()
        self.root = self.workspace_root / ".devagent" / "chats"
        self.attachments_root = self.workspace_root / ".devagent" / "attachments"

    def list(self) -> list[ChatSummary]:
        self.root.mkdir(parents=True, exist_ok=True)
        sessions = []
        for path in self.root.glob("*.json"):
            try:
                session = self._load_path(path)
            except Exception:
                continue
            sessions.append(
                ChatSummary(
                    id=session.id,
                    title=session.title,
                    createdAt=session.createdAt,
                    updatedAt=session.updatedAt,
                    lastMessage=last_message_preview(session.messages),
                )
            )
        return sorted(sessions, key=lambda item: item.updatedAt, reverse=True)

    def create(self, title: str | None = None) -> ChatSession:
        now = utc_now()
        session = ChatSession(
            id=str(uuid.uuid4()),
            title=(title or "New chat").strip() or "New chat",
            createdAt=now,
            updatedAt=now,
            messages=[],
        )
        self.save(session)
        return session

    def get(self, chat_id: str) -> ChatSession:
        path = self._path(chat_id)
        if not path.exists():
            raise KeyError("Chat not found")
        return self._load_path(path)

    def save(self, session: ChatSession) -> ChatSession:
        self.root.mkdir(parents=True, exist_ok=True)
        session = session.model_copy(update={"updatedAt": utc_now()})
        path = self._path(session.id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(session.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(path)
        return session

    def add_message(
        self,
        chat_id: str,
        *,
        role: str,
        content: str,
        attachment_ids: Iterable[str] = (),
        task_id: str | None = None,
        status: TaskStatus | None = None,
        llm_calls: list[LLMCallResult] | None = None,
        metadata: dict[str, object] | None = None,
    ) -> ChatMessage:
        session = self.get(chat_id)
        attachments = [attachment for attachment in self._all_attachments(chat_id) if attachment.id in set(attachment_ids)]
        message = ChatMessage(
            id=str(uuid.uuid4()),
            role=role,  # type: ignore[arg-type]
            content=content,
            taskId=task_id,
            status=status,
            attachments=attachments,
            llmCalls=llm_calls or [],
            metadata=metadata or {},
        )
        session.messages.append(message)
        if session.title == "New chat" and role == "user":
            session.title = build_title(content)
        self.save(session)
        return message

    def save_attachment(self, chat_id: str, filename: str, content_type: str, data: bytes) -> ChatAttachment:
        self.get(chat_id)
        attachment_id = str(uuid.uuid4())
        safe_name = sanitize_filename(filename) or f"attachment-{attachment_id}"
        target_dir = self.attachments_root / chat_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / f"{attachment_id}-{safe_name}"
        target_path.write_bytes(data)
        return ChatAttachment(
            id=attachment_id,
            name=safe_name,
            path=str(target_path.relative_to(self.workspace_root)).replace("\\", "/"),
            contentType=content_type or "application/octet-stream",
            size=len(data),
        )

    def attachment_context(self, chat_id: str, attachment_ids: Iterable[str]) -> str:
        selected = [attachment for attachment in self._all_attachments(chat_id) if attachment.id in set(attachment_ids)]
        parts = []
        for attachment in selected:
            target = (self.workspace_root / attachment.path).resolve()
            try:
                target.relative_to(self.attachments_root.resolve())
            except ValueError:
                continue
            if not target.is_file() or attachment.size > 250_000:
                parts.append(f"[Attachment: {attachment.name}, {attachment.size} bytes, not included inline]")
                continue
            try:
                text = target.read_text(encoding="utf-8", errors="replace")
            except Exception:
                parts.append(f"[Attachment: {attachment.name}, binary or unreadable]")
                continue
            if len(text) > 80_000:
                text = text[:80_000] + "\n[truncated]"
            parts.append(f"[Attachment: {attachment.name}]\n{text}")
        return "\n\n".join(parts)

    async def complete_task(self, state: TaskState, logs: list[AgentLogEvent]) -> None:
        if not state.chatId:
            return
        content = state.result or state.error or ""
        if not content:
            content = f"Task finished with status: {state.status.value}"
        self.add_message(
            state.chatId,
            role="assistant",
            content=content,
            task_id=state.taskId,
            status=state.status,
            llm_calls=state.llmCalls,
            metadata={
                "timeline": [log.model_dump(mode="json") for log in logs],
                "progress": state.progress,
            },
        )

    def _path(self, chat_id: str) -> Path:
        if not re.fullmatch(r"[a-zA-Z0-9._-]+", chat_id):
            raise KeyError("Chat not found")
        return self.root / f"{chat_id}.json"

    def _load_path(self, path: Path) -> ChatSession:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return ChatSession.model_validate(payload)

    def _all_attachments(self, chat_id: str) -> list[ChatAttachment]:
        session = self.get(chat_id)
        attachments: list[ChatAttachment] = []
        for message in session.messages:
            attachments.extend(message.attachments)
        attachment_dir = self.attachments_root / chat_id
        if attachment_dir.exists():
            known_ids = {attachment.id for attachment in attachments}
            for path in attachment_dir.iterdir():
                if not path.is_file():
                    continue
                attachment_id = path.name.split("-", 1)[0]
                if attachment_id in known_ids:
                    continue
                attachments.append(
                    ChatAttachment(
                        id=attachment_id,
                        name=path.name.split("-", 1)[-1],
                        path=str(path.relative_to(self.workspace_root)).replace("\\", "/"),
                        size=path.stat().st_size,
                    )
                )
        return attachments


def build_title(content: str) -> str:
    title = " ".join(content.strip().split())
    if len(title) > 64:
        title = title[:61] + "..."
    return title or "New chat"


def last_message_preview(messages: list[ChatMessage]) -> str:
    if not messages:
        return ""
    text = " ".join(messages[-1].content.strip().split())
    return text[:117] + "..." if len(text) > 120 else text


def sanitize_filename(filename: str) -> str:
    name = Path(filename).name.strip()
    return re.sub(r"[^a-zA-Z0-9а-яА-ЯёЁ._ -]+", "_", name).strip(" .")
