from __future__ import annotations

import argparse
import os
import platform
import shutil
import stat
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path


DEFAULT_VERSION = "4.117.0"


def main() -> None:
    parser = argparse.ArgumentParser(description="Install a prebuilt code-server release into .tools/code-server.")
    parser.add_argument("--workspace", default=".", help="DevAgent Hub workspace root.")
    parser.add_argument("--version", default=DEFAULT_VERSION)
    args = parser.parse_args()

    workspace = Path(args.workspace).expanduser().resolve()
    target = workspace / ".tools" / "code-server"
    existing = detect_command(target)
    if existing:
        print(existing)
        return

    asset_name = release_asset_name(args.version)
    url = f"https://github.com/coder/code-server/releases/download/v{args.version}/{asset_name}"
    downloads = workspace / ".tools" / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / asset_name
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, archive)

    with tempfile.TemporaryDirectory(prefix="devagent-code-server-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        if archive.suffix == ".zip":
            safe_extract_zip(archive, tmp_path)
        else:
            safe_extract_tar(archive, tmp_path)

        roots = [entry for entry in tmp_path.iterdir() if entry.is_dir()]
        if not roots:
            raise RuntimeError("code-server archive did not contain a directory.")
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(roots[0]), target)

    command = detect_command(target)
    if not command:
        raise RuntimeError("code-server was extracted, but the executable was not found.")
    make_executable(Path(command))
    print(command)


def release_asset_name(version: str) -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"aarch64", "arm64"} else "amd64"
    if system == "windows":
        return f"code-server-{version}-windows-{arch}.zip"
    if system == "linux":
        return f"code-server-{version}-linux-{arch}.tar.gz"
    if system == "darwin":
        return f"code-server-{version}-macos-{arch}.tar.gz"
    raise RuntimeError(f"Unsupported platform for prebuilt code-server: {system}/{machine}")


def detect_command(target: Path) -> str | None:
    candidates = [
        target / "bin" / "code-server",
        target / "bin" / "code-server.cmd",
        target / "code-server.cmd",
        target / "node_modules" / ".bin" / "code-server.cmd",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def make_executable(path: Path) -> None:
    if os.name == "nt":
        return
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def safe_extract_zip(archive: Path, target: Path) -> None:
    with zipfile.ZipFile(archive) as zip_ref:
        for member in zip_ref.namelist():
            destination = (target / member).resolve()
            destination.relative_to(target.resolve())
        zip_ref.extractall(target)


def safe_extract_tar(archive: Path, target: Path) -> None:
    with tarfile.open(archive, "r:gz") as tar_ref:
        for member in tar_ref.getmembers():
            destination = (target / member.name).resolve()
            destination.relative_to(target.resolve())
        tar_ref.extractall(target)


if __name__ == "__main__":
    main()
