from __future__ import annotations

import re
import uuid
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

import httpx

from .models import (
    BrowserDownloadResponse,
    BrowserLink,
    BrowserOpenRequest,
    BrowserPageResponse,
    BrowserScreenshotRequest,
    BrowserScreenshotResponse,
    BrowserStatusResponse,
)


class BrowserService:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()
        self.root = self.workspace_root / ".devagent" / "browser"
        self.screenshots_root = self.root / "screenshots"
        self.downloads_root = self.root / "downloads"

    async def status(self) -> BrowserStatusResponse:
        try:
            from playwright.async_api import async_playwright  # noqa: F401
        except ImportError:
            return BrowserStatusResponse(
                available=False,
                message="Playwright is not installed. Re-run the installer to install browser automation.",
            )
        return BrowserStatusResponse(
            available=True,
            message="Playwright is installed. Chromium will start on first browser action.",
        )

    async def open(self, request: BrowserOpenRequest) -> BrowserPageResponse:
        url = normalize_url(request.url)
        async with await self._playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(
                accept_downloads=True,
                ignore_https_errors=True,
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/123 Safari/537.36 DevAgentHub/1.0"
                ),
            )
            page = await context.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass

                title = await page.title()
                final_url = page.url
                text = await read_page_text(page, request.maxChars)
                links = await read_page_links(page, final_url)
                screenshot_path = None
                if request.screenshot:
                    screenshot_path = await self._save_screenshot(page, full_page=True)
                return BrowserPageResponse(
                    url=url,
                    finalUrl=final_url,
                    title=title,
                    text=text,
                    links=links,
                    screenshotPath=screenshot_path,
                )
            finally:
                await context.close()
                await browser.close()

    async def screenshot(self, request: BrowserScreenshotRequest) -> BrowserScreenshotResponse:
        url = normalize_url(request.url)
        async with await self._playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 1000})
            page = await context.new_page()
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                path = await self._save_screenshot(page, full_page=request.fullPage)
                return BrowserScreenshotResponse(url=page.url, path=path)
            finally:
                await context.close()
                await browser.close()

    async def download(self, request: BrowserDownloadRequest) -> BrowserDownloadResponse:
        url = normalize_url(request.url)
        filename = sanitize_filename(request.filename or suggested_filename(url))
        self.downloads_root.mkdir(parents=True, exist_ok=True)
        target = unique_path(self.downloads_root / filename)
        async with httpx.AsyncClient(follow_redirects=True, timeout=120.0, trust_env=True) as client:
            response = await client.get(url, headers={"User-Agent": "DevAgentHub/1.0"})
            response.raise_for_status()
            target.write_bytes(response.content)
            return BrowserDownloadResponse(
                url=str(response.url),
                path=relative_path(target, self.workspace_root),
                size=target.stat().st_size,
                contentType=response.headers.get("content-type", ""),
            )

    async def browse_context_for_urls(self, urls: list[str], max_pages: int = 3, max_chars_per_page: int = 12000) -> str:
        parts: list[str] = []
        seen: set[str] = set()
        for raw_url in urls:
            if len(parts) >= max_pages:
                break
            try:
                url = normalize_url(raw_url)
            except ValueError:
                continue
            if url in seen:
                continue
            seen.add(url)
            try:
                page = await self.open(BrowserOpenRequest(url=url, maxChars=max_chars_per_page))
            except Exception as exc:
                parts.append(f"[Browser error: {url}]\n{exc}")
                continue
            text = page.text.strip()
            if text:
                parts.append(f"[Browser page: {page.title or page.finalUrl}]\nURL: {page.finalUrl}\n{text}")
        return "\n\n".join(parts)

    async def browse_context_for_query(self, query: str, max_pages: int = 3, max_chars_per_page: int = 12000) -> str:
        results = await self.search(query, limit=max_pages)
        if not results:
            return f"[Browser search]\nNo browser search results found for: {query}"
        urls = [link.url for link in results]
        context = await self.browse_context_for_urls(urls, max_pages=max_pages, max_chars_per_page=max_chars_per_page)
        search_lines = "\n".join(f"- {link.text or link.url}: {link.url}" for link in results)
        return "\n\n".join(part for part in [f"[Browser search results]\n{search_lines}", context] if part)

    async def search(self, query: str, limit: int = 5) -> list[BrowserLink]:
        search_url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
        async with await self._playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(ignore_https_errors=True)
            page = await context.new_page()
            try:
                await page.goto(search_url, wait_until="domcontentloaded", timeout=45000)
                raw_links = await page.eval_on_selector_all(
                    "a.result__a, a[data-testid='result-title-a'], a[href]",
                    """(items) => items.slice(0, 40).map((a) => ({
                        text: (a.innerText || a.textContent || '').trim(),
                        href: a.href || a.getAttribute('href')
                    }))""",
                )
            finally:
                await context.close()
                await browser.close()

        links: list[BrowserLink] = []
        seen: set[str] = set()
        for item in raw_links:
            url = str(item.get("href") or "").strip()
            text = str(item.get("text") or "").strip()
            if not url.startswith(("http://", "https://")):
                continue
            parsed = urlparse(url)
            if "duckduckgo.com" in parsed.netloc:
                uddg = parse_qs(parsed.query).get("uddg", [])
                if not uddg:
                    continue
                url = unquote(uddg[0])
                parsed = urlparse(url)
                if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                    continue
            if url in seen:
                continue
            seen.add(url)
            links.append(BrowserLink(text=text[:160], url=url))
            if len(links) >= limit:
                break
        return links

    async def _playwright(self):
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise RuntimeError("Playwright is not installed. Re-run the installer.") from exc
        return async_playwright()

    async def _save_screenshot(self, page, full_page: bool) -> str:
        self.screenshots_root.mkdir(parents=True, exist_ok=True)
        target = self.screenshots_root / f"{uuid.uuid4()}.png"
        await page.screenshot(path=str(target), full_page=full_page)
        return relative_path(target, self.workspace_root)


async def read_page_text(page, max_chars: int) -> str:
    try:
        text = await page.locator("body").inner_text(timeout=8000)
    except Exception:
        html = await page.content()
        text = strip_html(html)
    text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if len(text) > max_chars:
        return text[:max_chars] + "\n[truncated]"
    return text


async def read_page_links(page, base_url: str) -> list[BrowserLink]:
    raw_links = await page.eval_on_selector_all(
        "a[href]",
        "(items) => items.slice(0, 80).map((a) => ({ text: (a.innerText || a.textContent || '').trim(), href: a.getAttribute('href') }))",
    )
    links: list[BrowserLink] = []
    seen: set[str] = set()
    for item in raw_links:
        href = str(item.get("href") or "").strip()
        if not href or href.startswith(("javascript:", "mailto:", "tel:")):
            continue
        url = urljoin(base_url, href)
        if url in seen:
            continue
        seen.add(url)
        links.append(BrowserLink(text=str(item.get("text") or "").strip()[:160], url=url))
    return links


def extract_urls(text: str) -> list[str]:
    return re.findall(r"https?://[^\s<>'\")]+", text)


def normalize_url(raw_url: str) -> str:
    url = raw_url.strip()
    if not url:
        raise ValueError("URL is empty.")
    if not re.match(r"^https?://", url, re.I):
        url = f"https://{url}"
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Unsupported browser URL: {raw_url}")
    return url


def suggested_filename(url: str) -> str:
    parsed = urlparse(url)
    name = Path(parsed.path).name.strip() or "download"
    return name


def sanitize_filename(filename: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9а-яА-ЯёЁ._ -]+", "_", Path(filename).name).strip(" .")
    return safe or "download"


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(2, 10000):
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{stem}-{uuid.uuid4().hex}{suffix}")


def relative_path(path: Path, workspace_root: Path) -> str:
    return str(path.resolve().relative_to(workspace_root.resolve())).replace("\\", "/")


def strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html)
