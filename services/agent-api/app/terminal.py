"""PTY-backed terminal exposed over WebSocket."""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect


class TerminalSession:
    def __init__(self, workspace_root: Path, shell: str | None = None) -> None:
        self.workspace_root = workspace_root.resolve()
        self.shell = shell or self._detect_shell()
        self.process: asyncio.subprocess.Process | None = None
        self.winpty = None
        self._master_fd: int | None = None

    @staticmethod
    def _detect_shell() -> str:
        if sys.platform == "win32":
            return os.getenv("COMSPEC", "cmd.exe")
        return os.getenv("SHELL", "/bin/sh")

    async def start(self) -> None:
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        if sys.platform == "win32":
            await self._start_windows(env)
            return
        await self._start_unix(env)

    async def _start_windows(self, env: dict[str, str]) -> None:
        try:
            from winpty import PtyProcess
        except ImportError as exc:
            raise RuntimeError("pywinpty is required for the Windows terminal. Re-run install.ps1.") from exc

        self.winpty = await asyncio.to_thread(
            PtyProcess.spawn,
            self.shell,
            cwd=str(self.workspace_root),
            env=env,
        )

    async def _start_unix(self, env: dict[str, str]) -> None:
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
            preexec_fn=os.setsid,
        )
        os.close(slave_fd)
        self._master_fd = master_fd

    async def read_loop(self, ws: WebSocket) -> None:
        if sys.platform == "win32":
            await self._read_windows(ws)
            return
        await self._read_unix(ws)

    async def _read_windows(self, ws: WebSocket) -> None:
        assert self.winpty is not None
        while True:
            if not self.winpty.isalive():
                break
            try:
                data = await asyncio.to_thread(self.winpty.read, 4096)
            except EOFError:
                break
            if data:
                await ws.send_json({"type": "output", "data": data})
            else:
                await asyncio.sleep(0.03)

    async def _read_unix(self, ws: WebSocket) -> None:
        loop = asyncio.get_running_loop()
        assert self._master_fd is not None
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
        if sys.platform == "win32":
            if self.winpty is not None:
                await asyncio.to_thread(self.winpty.write, data)
            return

        if self._master_fd is not None:
            os.write(self._master_fd, data.encode("utf-8"))

    async def resize(self, cols: int, rows: int) -> None:
        cols = max(20, min(cols, 300))
        rows = max(5, min(rows, 120))
        if sys.platform == "win32":
            if self.winpty is not None:
                await asyncio.to_thread(self.winpty.set_size, cols, rows)
            return

        if self._master_fd is None:
            return
        import fcntl
        import struct
        import termios

        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)

    async def close(self) -> None:
        if sys.platform == "win32":
            if self.winpty is not None and self.winpty.isalive():
                await asyncio.to_thread(self.winpty.terminate)
            return

        if self.process and self.process.returncode is None:
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
        if self._master_fd is not None:
            try:
                os.close(self._master_fd)
            except OSError:
                pass


class TerminalManager:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root

    async def handle(self, ws: WebSocket) -> None:
        await ws.accept()
        session = TerminalSession(self.workspace_root)
        read_task: asyncio.Task[None] | None = None
        try:
            await session.start()
            read_task = asyncio.create_task(session.read_loop(ws))
            await session.write("\r\nOrqen Studio terminal ready.\r\n")
            while True:
                message = await ws.receive_text()
                payload = json.loads(message)
                msg_type = payload.get("type")
                if msg_type == "input":
                    await session.write(str(payload.get("data", "")))
                elif msg_type == "resize":
                    await session.resize(int(payload.get("cols", 80)), int(payload.get("rows", 24)))
        except WebSocketDisconnect:
            pass
        finally:
            if read_task is not None:
                read_task.cancel()
                try:
                    await read_task
                except (asyncio.CancelledError, Exception):
                    pass
            await session.close()
