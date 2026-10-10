import { useEffect, useRef, useState } from "preact/hooks";
import { desktopBridge, type DesktopStatus, type DownloadStatus } from "./desktop-bridge.ts";
import { formatBytes } from "./device-store.ts";
import "./model-download.css";

/** How long "Translation is ready" stays after the download finishes. */
const doneMs = 8000;

/** "about 12 min left", from the bytes still to come and the recent speed; nothing until the speed is known. */
export function timeLeft(remaining: number, bytesPerSecond: number | null): string | null {
  if (!bytesPerSecond || bytesPerSecond <= 0 || remaining <= 0) return null;
  const seconds = remaining / bytesPerSecond;
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} h${rest ? ` ${rest} min` : ""} left`;
}

/**
 * The translation model's download, wherever the reader is in the desktop app (the Library, a Book, Settings): a small
 * card with a progress bar, how much has arrived, the time left, and Pause or Resume. It shows while the model downloads,
 * is checked, is paused (also after the app was closed mid-way) or failed, and for a moment after it is done. Only in
 * the desktop app (its bridge, desktop-bridge.ts); a browser never shows it.
 */
export function ModelDownload() {
  const bridge = desktopBridge();
  const [download, setDownload] = useState<DownloadStatus | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const last = useRef<{ received: number; at: number } | null>(null);
  const previous = useRef<DownloadStatus["state"] | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;
    const take = (status: DesktopStatus | null) => {
      if (!status) return;
      const next = status.download;
      // The speed: smoothed over the progress reports (four a second), so the time left does not jump about.
      if (next.state === "downloading") {
        const now = performance.now();
        const before = last.current;
        if (before && now > before.at && next.received >= before.received) {
          const instant = ((next.received - before.received) * 1000) / (now - before.at);
          setSpeed((old) => (old === null ? instant : old * 0.9 + instant * 0.1));
        }
        last.current = { received: next.received, at: now };
      } else {
        last.current = null;
        setSpeed(null);
      }
      if (next.state === "done" && previous.current !== "done" && previous.current !== null) {
        setShowDone(true);
        clearTimeout(doneTimer);
        doneTimer = setTimeout(() => setShowDone(false), doneMs);
      }
      if (next.state !== previous.current) setHidden(false);
      previous.current = next.state;
      setDownload(next);
    };
    void bridge.status().then(take);
    const stop = bridge.onStatus(take);
    return () => {
      stop();
      clearTimeout(doneTimer);
    };
  }, []);

  if (!bridge || !download || hidden) return null;
  const visible = download.state === "downloading" || download.state === "verifying" || download.state === "paused" || download.state === "failed" || (download.state === "done" && showDone);
  if (!visible) return null;

  const act = (action: "start" | "pause") => void bridge.download(action).then((status) => status && setDownload(status.download));
  // Downloading, checking or paused: how far it got.
  const progress = "received" in download ? download : { received: 0, total: 0 };
  const percent = progress.total ? Math.floor((progress.received / progress.total) * 100) : null;

  return (
    <section class="model-download-card" aria-label="Translation model download" data-state={download.state}>
      {download.state === "done" ? (
        <>
          <p class="model-download-title">Translation is ready</p>
          <p class="model-download-detail">Turn on Translate in an English Book to read it with Chinese.</p>
        </>
      ) : download.state === "failed" ? (
        <>
          <p class="model-download-title">The model did not download</p>
          <p class="model-download-detail" role="alert">
            {download.message}
          </p>
          <div class="model-download-actions">
            <button type="button" class="model-download-button primary" onClick={() => act("start")}>
              Try again
            </button>
            <button type="button" class="model-download-button" onClick={() => setHidden(true)}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="model-download-title">
            {download.state === "verifying" ? "Checking the translation model…" : download.state === "paused" ? "Translation model download paused" : "Downloading the translation model"}
          </p>
          <progress
            class="model-download-bar"
            max={progress.total}
            // A file being checked has no amount to show: the bar moves without one.
            value={download.state === "verifying" ? undefined : progress.received}
            aria-label="Download progress"
          />
          <p class="model-download-detail" role="status" aria-live="off">
            {download.state === "verifying"
              ? "Making sure it is the published file."
              : [`${formatBytes(progress.received)} of ${formatBytes(progress.total)}`, percent !== null ? `${percent}%` : null, download.state === "downloading" ? timeLeft(progress.total - progress.received, speed) : null]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
          <div class="model-download-actions">
            {download.state === "paused" ? (
              <button type="button" class="model-download-button primary" onClick={() => act("start")}>
                Resume
              </button>
            ) : (
              <button type="button" class="model-download-button" disabled={download.state === "verifying"} onClick={() => act("pause")}>
                Pause
              </button>
            )}
            <a class="model-download-button" href="#/settings">
              Details
            </a>
          </div>
        </>
      )}
    </section>
  );
}
