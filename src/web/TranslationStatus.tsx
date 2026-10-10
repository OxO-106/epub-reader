import type { Ref } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { TranslationStatus } from "./reader/reader.ts";
import { ChevronDown, CloseIcon } from "./ReaderIcons.tsx";

/** What the status pill says, how it is coloured and whether it opens the panel with hints and Retry. */
export interface StatusView {
  kind: "translating" | "ready" | "not-set-up" | "unreachable" | "error" | "failed";
  label: string;
  tone: "working" | "ok" | "alert" | "neutral";
  /** The pill is a button that opens the panel (hints for "Not set up", hints and Retry for trouble). */
  panel: boolean;
  /** Retry is offered. */
  retry: boolean;
}

/** The pill for the engine's status; null when translation is off (nothing to show). */
export function describeStatus(status: TranslationStatus | null): StatusView | null {
  if (!status || status.state === "idle") return null;
  if (status.state === "not-set-up") return { kind: "not-set-up", label: "Not set up", tone: "neutral", panel: true, retry: false };
  if (status.state === "unreachable") return { kind: "unreachable", label: "Backend unreachable", tone: "alert", panel: true, retry: true };
  if (status.state === "error" || status.failed.length > 0) {
    const label = status.failed.length > 0 ? "Some paragraphs failed" : "Translation keeps failing";
    return { kind: status.state === "error" ? "error" : "failed", label, tone: "alert", panel: true, retry: true };
  }
  if (status.state === "translating") return { kind: "translating", label: "Translating ahead", tone: "working", panel: false, retry: false };
  return { kind: "ready", label: "Ready", tone: "ok", panel: false, retry: false };
}

/**
 * The status pill in the top bar: a dot and the words (only the dot on a phone, the words stay for screen readers). It sits
 * in a polite live region, so changes are announced without interrupting. When there is something to do it is a real button
 * that opens the panel (see TranslationPanel), reachable by keyboard.
 */
export function TranslationPill({
  view,
  open,
  buttonRef,
  onToggle,
}: {
  view: StatusView;
  open: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  onToggle(): void;
}) {
  const face = (
    <span class="reader-status-face" data-tone={view.tone}>
      <span class="reader-status-dot" aria-hidden="true" />
      <span class="reader-status-text">{view.label}</span>
      {view.panel && <ChevronDown />}
    </span>
  );
  return (
    <span class="reader-status-slot" role="status" aria-live="polite" aria-atomic="true" data-kind={view.kind}>
      {view.panel ? (
        <button type="button" ref={buttonRef} class="reader-status reader-status-button" aria-expanded={open} aria-controls="translation-panel" onClick={onToggle}>
          {face}
        </button>
      ) : (
        <span class="reader-status">{face}</span>
      )}
    </span>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What to do about the trouble the pill reports. A small popover under the pill (a sheet on a phone), never a dialog:
 * the text stays readable and usable behind it, and Escape or the pill closes it.
 */
export function TranslationPanel({
  view,
  status,
  onRetry,
  onClose,
}: {
  view: StatusView;
  status: TranslationStatus;
  onRetry(): void;
  onClose(): void;
}) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    // Keyboard users arrive on Retry when there is one, otherwise on the panel itself.
    const retry = panel.current?.querySelector<HTMLElement>(".translation-retry");
    (retry ?? panel.current)?.focus();
  }, []);

  return (
    <section ref={panel} id="translation-panel" class="reader-panel display-panel translation-panel" aria-label="Translation status" tabIndex={-1} data-no-page-turn>
      <div class="panel-head sheet-head">
        <h2>Translation</h2>
        <button type="button" class="icon-button" aria-label="Close translation status" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {view.kind === "not-set-up" && (
        <>
          <h3>Translation is not set up</h3>
          <p>Verso can show a Chinese translation under each English paragraph, but it needs a model server to write it. Until then the English reads as usual.</p>
          <p>
            Tell the app where the model server is by setting <code>READER_TRANSLATE_URL</code> to its address (for example <code>http://127.0.0.1:8080</code>)
            and, if that server holds more than one model, <code>READER_TRANSLATE_MODEL</code> to the one to use. Then restart Reader.
          </p>
          <p>
            <code>docs/translation-setup.md</code> explains how to download a model and start the server.
          </p>
        </>
      )}

      {view.kind === "unreachable" && (
        <>
          <h3>The model server is not answering</h3>
          <p>
            Reading is not affected. Start the model server with <code>npm run translate:server</code> (<code>docs/translation-setup.md</code> has the whole guide).
          </p>
          <p>Verso asks again every few seconds and carries on by itself once the server is back. Retry asks right now.</p>
        </>
      )}

      {view.kind === "error" && (
        <>
          <h3>The model server keeps failing</h3>
          <p>
            It answers, but with errors, so Verso has paused translating. Reading is not affected. Look at the model server&rsquo;s window or log
            (<code>docs/translation-setup.md</code>, Troubleshooting), then press Retry.
          </p>
        </>
      )}

      {view.kind === "failed" && (
        <>
          <h3>Some paragraphs failed</h3>
          <p>
            {count(status.failed.length, "paragraph")} could not be translated. The English is not affected. Retry tries {status.failed.length === 1 ? "it" : "them"} again;
            clicking the notice under a single paragraph retries just that one.
          </p>
        </>
      )}

      {view.retry && (
        <button type="button" class="translation-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </section>
  );
}
