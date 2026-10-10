import { useEffect, useState } from "preact/hooks";
import type { NewName } from "./reader/reader.ts";
import { CloseIcon } from "./ReaderIcons.tsx";

/**
 * Asks the reader about a name translation has just met (ADR 0180): is it a name, and is its Chinese form right? One
 * name at a time, the oldest first, and not while a panel is open. It never takes focus, so reading goes on; Enter in
 * the field keeps the name. Keep saves the form (edited or not) as the reader's; Not a name stops it being treated as
 * one in this Book; Later leaves the model's form, marked "not checked" in the Glossary panel. Keep and Not a name
 * resolve with null when saved, or with what to tell the reader when not.
 */
export function NameCheck({
  names,
  onKeep,
  onNotName,
  onLater,
  onStopAsking,
}: {
  names: readonly NewName[];
  onKeep(name: NewName, form: string): Promise<string | null>;
  onNotName(name: NewName): Promise<string | null>;
  onLater(name: NewName): void;
  onStopAsking(): void;
}) {
  const current = names[0];
  const [form, setForm] = useState(current?.form ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setForm(current?.form ?? "");
    setProblem(null);
  }, [current?.key]);
  if (!current) return null;

  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    const refused = await action();
    setBusy(false);
    setProblem(refused);
  }
  const keep = () => run(() => onKeep(current, form.trim()));

  return (
    <section class="name-check" aria-labelledby="name-check-title" data-no-page-turn>
      <div class="name-check-head">
        <p id="name-check-title" class="name-check-label">
          New name{names.length > 1 ? ` · 1 of ${names.length}` : ""}
        </p>
        <button type="button" class="icon-button" aria-label="Ask later" title="Later" onClick={() => onLater(current)}>
          <CloseIcon size={16} />
        </button>
      </div>
      <p class="name-check-name">{current.name}</p>
      <input
        class="name-check-form"
        lang="zh-Hans"
        aria-label={`Chinese for ${current.name}`}
        value={form}
        maxLength={12}
        onInput={(event) => setForm(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void keep();
          }
        }}
      />
      <p class="name-check-problem" role="alert">
        {problem ?? ""}
      </p>
      <div class="name-check-actions">
        <button type="button" class="name-check-keep" disabled={busy || !form.trim()} onClick={() => void keep()}>
          Keep
        </button>
        <button type="button" class="name-check-action" disabled={busy} onClick={() => void run(() => onNotName(current))}>
          Not a name
        </button>
        <button type="button" class="name-check-stop" onClick={onStopAsking}>
          Stop asking
        </button>
      </div>
    </section>
  );
}
