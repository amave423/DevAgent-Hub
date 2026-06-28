"""PTY-backed terminal exposed over WebSocket."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


class TerminalSession:
    """A single PTY shell session."""

    def __init__(self, workspace_root: Path, shell: str | None = None) -> None:
        self.workspace_root = workspace_root.resolve()
        self.shell = shell or self._detect_shell()
        self.process: asyncio.subprocess.Process | None = None
        self._stdout_task: asyncio.Task[None] | None = None

    @staticmethod
    def _detect_shell() -> str:
        if sys.platform == "win32":
            return os.getenv("COMSPEC", "cmd.exe")
        return os.getenv("SHELL", "/bin/sh")

    async def start(self) -> None:
        if self.process is not None:
            return
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        if sys.platform == "win32":
            self.process = await asyncio.create_subprocess_shell(
                self.shell,
                cwd=str(self.workspace_root),
                env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        else:
            import pty  # type: ignore[import-untyped]

            master_fd, slave_fd = pty.openpty()
            self.process = await asyncio.create_subprocess_shell(
                self.shell,
                cwd=str(self.workspace_root),
                env=env,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                close_fds=True,
            )
            os.close(slave_fd)
            self._master_fd = master_fd

    async def read_loop(self, ws: WebSocket) -> None:
        try:
            if sys.platform == "win32":
                await self._read_windows(ws)
            else:
                await self._read_unix(ws)
        except Exception:
            pass

    async def _read_windows(self, ws: WebSocket) -> None:
        assert self.process is not None
        assert self.process.stdout is not None
        while True:
            data = await self.process.stdout.read(4096)
            if not data:
                break
            await ws.send_json({"type": "output", "data": data.decode("utf-8", errors="replace")})

    async def _read_unix(self, ws: WebSocket) -> None:
        loop = asyncio.get_running_loop()
        assert hasattr(self, "_master_fd")
        fd = self._master_fd

        def _read() -> bytes:
            import select
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                return os.read(fd, 4096)
            return b""

        while True:
            data = await loop.run_in_executor(None, _read)
            if data:
                await ws.send_json({"type": "output", "data": data.decode("utf-8", errors="replace")})
            elif self.process and self.process.returncode is not None:
                break
            else:
                await asyncio.sleep(0.05)

    async def write(self, data: str) -> None:
        if self.process is None or self.process.stdin is None:
            return
        if sys.platform == "win32":
            self.process.stdin.write(data.encode("utf-8"))
            await self.process.stdin.drain()
        else:
            import tty
            import termios
            assert hasattr(self, "_master_fd")
            os.write(self._master_fd, data.encode("utf-8"))

    async def resize(self, cols: int, rows: int) -> None:
        if sys.platform == "win32":
            return
        assert hasattr(self, "_master_fd")
        import fcntl
        import struct
        import termios
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)

    async def close(self) -> None:
        if self.process and self.process.returncode is None:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except (asyncio.TimeoutError, Exception):
                try:
                    self.process.kill()
                except Exception:
                    pass
        if hasattr(self, "_master_fd"):
            try:
                os.close(self._master_fd)
            except Exception:
                pass


class TerminalManager:
    """Manages terminal sessions (one per WebSocket connection)."""

    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root

    async def handle(self, ws: WebSocket) -> None:
        await ws.accept()
        session = TerminalSession(self.workspace_root)
        await session.start()
        try:
            await session.write("\r\nDevAgent Hub terminal ready.\r\n")
            read_task = asyncio.create_task(session.read_loop(ws))
            while True:
                message = await ws.receive_text()
                payload = json.loads(message)
                msg_type = payload.get("type")
                if msg_type == "input":
                    await session.write(payload.get("data", ""))
                elif msg_type == "resize":
                    await session.resize(int(payload.get("cols", 80)), int(payload.get("rows", 24)))
        except WebSocketDisconnect:
            pass
        finally:
            read_task.cancel()
            try:
                await read_task
            except (asyncio.CancelledError, Exception):
                pass
            await session.close()
