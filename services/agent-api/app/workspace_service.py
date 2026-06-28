from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Sequence

from .models import (
    GitCommitRequest,
    GitHubCreateRepoRequest,
    GitHubPullRequestRequest,
    GitHubStatus,
    GitPushRequest,
    GitStatus,
    OpenVSCodeStatus,
    SetGitRemoteRequest,
    StartOpenVSCodeRequest,
    WorkspaceActionResponse,
    WorkspaceStatus,
)


def default_workspace_root() -> Path:
    env_path = os.getenv("DEVAGENT_WORKSPACE")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return Path(__file__).resolve().parents[3]


class WorkspaceService:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or default_workspace_root()).resolve()

    def status(self, openvscode: OpenVSCodeManager) -> WorkspaceStatus:
        git = self.git_status()
        return WorkspaceStatus(
            rootPath=str(self.root),
            git=git,
            openVsCode=openvscode.status(),
            github=GitHubStatus(
                tokenConfigured=bool(github_token()),
                owner=parse_github_remote(git.remoteUrl)[0] if git.remoteUrl else None,
                repository=parse_github_remote(git.remoteUrl)[1] if git.remoteUrl else None,
                remoteUrl=git.remoteUrl,
                message="GitHub token is configured." if github_token() else "Set GITHUB_TOKEN or GH_TOKEN to enable GitHub automation.",
            ),
        )

    def git_status(self) -> GitStatus:
        if not shutil.which("git"):
            return GitStatus(
                available=False,
                isRepository=False,
                message="git executable was not found in PATH.",
            )

        inside = self._git(["rev-parse", "--is-inside-work-tree"], check=False)
        if inside.returncode != 0:
            return GitStatus(
                available=True,
                isRepository=False,
                message=inside.stderr.strip() or "Workspace is not a git repository.",
            )

        branch = self._git(["branch", "--show-current"], check=False).stdout.strip() or None
        remote = self._git(["remote", "get-url", "origin"], check=False)
        last_commit = self._git(["log", "-1", "--oneline"], check=False)
        changes = [
            line.rstrip()
            for line in self._git(["status", "--short"], check=False).stdout.splitlines()
            if line.strip()
        ]
        remote_url = remote.stdout.strip() or None
        owner, repository = parse_github_remote(remote_url)

        return GitStatus(
            available=True,
            isRepository=True,
            branch=branch,
            remoteUrl=remote_url,
            repository=f"{owner}/{repository}" if owner and repository else None,
            changes=changes,
            lastCommit=last_commit.stdout.strip() or None,
            message="Git repository is ready.",
        )

    def set_remote(self, request: SetGitRemoteRequest) -> WorkspaceActionResponse:
        self._ensure_git_repository()
        existing = self._git(["remote", "get-url", request.remote], check=False)
        if existing.returncode == 0:
            result = self._git(["remote", "set-url", request.remote, request.url])
        else:
            result = self._git(["remote", "add", request.remote, request.url])
        return WorkspaceActionResponse(ok=True, message=f"Remote {request.remote} configured.", output=result.stdout)

    def commit(self, request: GitCommitRequest) -> WorkspaceActionResponse:
        self._ensure_git_repository()
        files = [self._validate_relative_path(path) for path in request.files]
        if files:
            self._git(["add", "--", *files])
        if not files and not request.allowEmpty:
            raise ValueError("Provide files to stage, or set allowEmpty=true.")

        args = ["commit", "-m", request.message]
        if request.allowEmpty:
            args.append("--allow-empty")
        result = self._git(args)
        return WorkspaceActionResponse(ok=True, message="Commit created.", output=result.stdout.strip())

    def push(self, request: GitPushRequest) -> WorkspaceActionResponse:
        self._ensure_git_repository()
        branch = request.branch or self.git_status().branch
        if not branch:
            raise ValueError("Cannot determine branch to push.")
        args = ["push"]
        if request.setUpstream:
            args.append("-u")
        args.extend([request.remote, branch])
        result = self._git(args)
        return WorkspaceActionResponse(ok=True, message=f"Pushed {branch} to {request.remote}.", output=result.stdout.strip())

    def _ensure_git_repository(self) -> None:
        status = self.git_status()
        if not status.available:
            raise RuntimeError(status.message)
        if not status.isRepository:
            raise RuntimeError("Workspace is not a git repository.")

    def _validate_relative_path(self, raw_path: str) -> str:
        if not raw_path or raw_path in {".", "/"}:
            raise ValueError("Refusing broad git add path.")
        path = Path(raw_path)
        if path.is_absolute():
            raise ValueError("Only workspace-relative paths are allowed.")
        resolved = (self.root / path).resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise ValueError(f"Path escapes workspace: {raw_path}") from exc
        if ".git" in resolved.relative_to(self.root).parts:
            raise ValueError("Refusing to stage .git internals.")
        return raw_path.replace("\\", "/")

    def _git(self, args: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
        return run_process(["git", "-c", f"safe.directory={self.root.as_posix()}", *args], cwd=self.root, check=check)


class OpenVSCodeManager:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()
        self.process: subprocess.Popen[str] | None = None
        self.last_url: str | None = os.getenv("OPENVSCODE_URL")
        self.last_command: str | None = os.getenv("OPENVSCODE_COMMAND")

    def status(self) -> OpenVSCodeStatus:
        running = self.process is not None and self.process.poll() is None
        command = self.last_command if running else detect_openvscode_command(self.workspace_root) or self.last_command
        url = self.last_url if running or self.last_url else os.getenv("OPENVSCODE_URL")
        return OpenVSCodeStatus(
            configured=bool(command or url),
            running=running,
            url=url,
            pid=self.process.pid if running and self.process else None,
            command=command,
            workspacePath=str(self.workspace_root),
            message=build_openvscode_message(command, running, url),
        )

    def start(self, request: StartOpenVSCodeRequest) -> OpenVSCodeStatus:
        if self.process is not None and self.process.poll() is None:
            return self.status()

        command = request.command or detect_openvscode_command(self.workspace_root) or self.last_command
        if not command:
            raise RuntimeError("OpenVSCode Server command not found. Set OPENVSCODE_COMMAND or install openvscode-server.")

        workspace = self._resolve_workspace(request.workspacePath)
        args = build_openvscode_args(command, request, workspace)
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            args,
            cwd=workspace,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
            creationflags=creationflags,
        )
        self.last_command = command
        self.last_url = f"http://{request.host}:{request.port}"
        return self.status()

    def stop(self) -> OpenVSCodeStatus:
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=8)
        return self.status()

    def install(self) -> WorkspaceActionResponse:
        """Install code-server into .tools/ if no browser editor is available."""
        target_dir = self.workspace_root / ".tools" / "code-server"
        existing = detect_openvscode_command(self.workspace_root)
        if existing:
            return WorkspaceActionResponse(
                ok=True,
                message="OpenVSCode Server is already available.",
                output=existing,
            )

        target_dir.mkdir(parents=True, exist_ok=True)
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
        if not npm:
            raise RuntimeError("npm was not found in PATH. Install Node.js 22 before installing the browser code editor.")

        result = run_process(
            [npm, "install", "--prefix", str(target_dir), "code-server@4.117.0"],
            cwd=self.workspace_root,
            timeout=900,
        )
        result_cmd = detect_openvscode_command(self.workspace_root)
        if not result_cmd:
            raise RuntimeError("code-server installation finished, but the executable was not found.")
        return WorkspaceActionResponse(
            ok=True,
            message="Browser code editor installed successfully.",
            output=f"{result_cmd}\n\n{result.stdout[-4000:]}",
        )

    def _resolve_workspace(self, raw_path: str | None) -> Path:
        workspace = (Path(raw_path).expanduser() if raw_path else self.workspace_root).resolve()
        allow_external = os.getenv("DEVAGENT_ALLOW_EXTERNAL_WORKSPACE") == "1"
        if not allow_external:
            try:
                workspace.relative_to(self.workspace_root)
            except ValueError as exc:
                raise ValueError("OpenVSCode workspace must stay inside DEVAGENT_WORKSPACE.") from exc
        if not workspace.exists() or not workspace.is_dir():
            raise ValueError(f"Workspace path does not exist: {workspace}")
        return workspace


class GitHubService:
    def __init__(self, workspace: WorkspaceService) -> None:
        self.workspace = workspace

    def create_repo(self, request: GitHubCreateRepoRequest) -> WorkspaceActionResponse:
        token = require_github_token()
        payload = {
            "name": request.name,
            "description": request.description,
            "private": request.visibility == "private",
            "auto_init": False,
        }
        endpoint = "https://api.github.com/user/repos"
        if request.owner:
            current_user = github_get(token, "https://api.github.com/user")
            login = str(current_user.get("login") or "")
            if login.lower() != request.owner.lower():
                endpoint = f"https://api.github.com/orgs/{request.owner}/repos"
        data = github_post(token, endpoint, payload)
        clone_url = str(data.get("clone_url") or data.get("html_url") or "")
        return WorkspaceActionResponse(ok=True, message="GitHub repository created.", output=json.dumps(data, ensure_ascii=False), url=clone_url)

    def create_pull_request(self, request: GitHubPullRequestRequest) -> WorkspaceActionResponse:
        token = require_github_token()
        endpoint = f"https://api.github.com/repos/{request.owner}/{request.repository}/pulls"
        payload = {
            "title": request.title,
            "head": request.head,
            "base": request.base,
            "body": request.body,
        }
        data = github_post(token, endpoint, payload)
        return WorkspaceActionResponse(
            ok=True,
            message="Pull request created.",
            output=json.dumps(data, ensure_ascii=False),
            url=str(data.get("html_url") or ""),
        )


def build_openvscode_args(command: str, request: StartOpenVSCodeRequest, workspace: Path) -> list[str]:
    executable = Path(command).name.lower()
    if executable.startswith("code-server"):
        data_dir = workspace / ".tools" / "code-server-data"
        extensions_dir = workspace / ".tools" / "code-server-extensions"
        config_path = workspace / ".tools" / "code-server-config" / "config.yaml"
        return [
            command,
            "--bind-addr",
            f"{request.host}:{request.port}",
            "--auth",
            "none",
            "--config",
            str(config_path),
            "--user-data-dir",
            str(data_dir),
            "--extensions-dir",
            str(extensions_dir),
            str(workspace),
        ]

    args = [command, "--host", request.host, "--port", str(request.port)]
    if request.withoutConnectionToken and request.host in {"127.0.0.1", "localhost"}:
        args.append("--without-connection-token")
    args.append(str(workspace))
    return args


def detect_openvscode_command(workspace_root: Path | None = None) -> str | None:
    if workspace_root:
        local_candidates = [
            workspace_root / ".tools" / "code-server" / "code-server.cmd",
            workspace_root / ".tools" / "code-server" / "node_modules" / ".bin" / "code-server.cmd",
            workspace_root / ".tools" / "code-server" / "bin" / "code-server",
            workspace_root / ".tools" / "openvscode-server" / "bin" / "openvscode-server",
        ]
        for candidate in local_candidates:
            if candidate.exists():
                return str(candidate)

    for candidate in ("openvscode-server", "code-server"):
        found = shutil.which(candidate)
        if found:
            return found
    return None


def build_openvscode_message(command: str | None, running: bool, url: str | None) -> str:
    if running and url:
        return f"OpenVSCode Server is running at {url}."
    if command:
        return "OpenVSCode Server command is available."
    if url:
        return "OpenVSCode URL is configured externally."
    return "OpenVSCode Server is not configured yet."


def run_process(args: Sequence[str], *, cwd: Path, check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(args),
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"Command failed: {' '.join(args)}")
    return result


def github_token() -> str | None:
    return os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")


def require_github_token() -> str:
    token = github_token()
    if not token:
        raise RuntimeError("Set GITHUB_TOKEN or GH_TOKEN before using GitHub automation.")
    return token


def github_post(token: str, url: str, payload: dict[str, object]) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "DevAgent-Hub",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API error {exc.code}: {details}") from exc


def github_get(token: str, url: str) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "DevAgent-Hub",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API error {exc.code}: {details}") from exc


def parse_github_remote(remote_url: str | None) -> tuple[str | None, str | None]:
    if not remote_url:
        return None, None
    patterns = [
        r"github\.com[:/](?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?$",
        r"github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+?)(?:\.git)?$",
    ]
    for pattern in patterns:
        match = re.search(pattern, remote_url)
        if match:
            return match.group("owner"), match.group("repo")
    return None, None
