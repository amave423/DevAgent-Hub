import { Download, Globe2, Image, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  captureBrowserScreenshot,
  downloadBrowserFile,
  getBrowserStatus,
  openBrowserPage,
} from "../api/browser";
import { PanelHeader } from "../components/PanelHeader";
import type { PageInfoContent } from "../i18n/pageInfo";
import type { BrowserDownloadResponse, BrowserPageResponse, BrowserStatusResponse } from "../types";
import type { CopyKey } from "../i18n/ru";

export function BrowserPanel({
  t,
  info,
}: {
  t: (key: CopyKey) => string;
  info: PageInfoContent;
}) {
  const [url, setUrl] = useState("https://example.com");
  const [status, setStatus] = useState<BrowserStatusResponse | null>(null);
  const [page, setPage] = useState<BrowserPageResponse | null>(null);
  const [download, setDownload] = useState<BrowserDownloadResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function refreshStatus() {
    try {
      setStatus(await getBrowserStatus());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Browser status failed.");
    }
  }

  async function runAction(action: () => Promise<void>) {
    setNotice(null);
    setIsBusy(true);
    try {
      await action();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Browser action failed.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="tab-panel browser-panel">
      <PanelHeader
        title={t("browserTitle")}
        subtitle={status?.message || t("browserSubtitle")}
        info={info}
        infoLabel={t("info")}
        action={
          <button className="secondary-button" type="button" onClick={() => void refreshStatus()}>
            <RefreshCw size={16} />
            {t("refresh")}
          </button>
        }
      />

      {notice && <div className="notice-strip inline">{notice}</div>}

      <section className="browser-control">
        <label className="field">
          <span>{t("browserUrl")}</span>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" />
        </label>
        <div className="inline-actions left">
          <button
            className="primary-button"
            type="button"
            disabled={isBusy || !url.trim()}
            onClick={() => void runAction(async () => setPage(await openBrowserPage(url, false)))}
          >
            {isBusy ? <Loader2 className="spin" size={16} /> : <Globe2 size={16} />}
            {t("browserOpenRead")}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={isBusy || !url.trim()}
            onClick={() => void runAction(async () => setPage(await openBrowserPage(url, true)))}
          >
            <Image size={16} />
            {t("browserOpenScreenshot")}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={isBusy || !url.trim()}
            onClick={() => void runAction(async () => {
              const screenshot = await captureBrowserScreenshot(url);
              setPage((current) =>
                current
                  ? { ...current, screenshotPath: screenshot.path }
                  : {
                      url,
                      finalUrl: screenshot.url,
                      title: screenshot.url,
                      text: "",
                      links: [],
                      screenshotPath: screenshot.path,
                    },
              );
            })}
          >
            <Image size={16} />
            {t("browserScreenshot")}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={isBusy || !url.trim()}
            onClick={() => void runAction(async () => setDownload(await downloadBrowserFile(url)))}
          >
            <Download size={16} />
            {t("browserDownload")}
          </button>
        </div>
      </section>

      <div className="browser-results">
        {download && (
          <section>
            <h3>{t("browserDownloadResult")}</h3>
            <code>{download.path}</code>
            <span>{download.size} bytes {download.contentType ? `- ${download.contentType}` : ""}</span>
          </section>
        )}

        {page && (
          <section>
            <div className="section-heading compact">
              <div>
                <h3>{page.title || page.finalUrl}</h3>
                <span>{page.finalUrl}</span>
              </div>
            </div>
            {page.screenshotPath && <code>{page.screenshotPath}</code>}
            <pre>{page.text || t("browserNoText")}</pre>
            {page.links.length > 0 && (
              <div className="browser-links">
                {page.links.slice(0, 20).map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                    {link.text || link.url}
                  </a>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
