import { useEffect, useRef, useState } from "preact/hooks";
import { deleteGlossaryEntry, getGlossary, GlossaryRefusal, glossaryExportUrl, importGlossary, setGlossaryEntry, type GlossaryEntry } from "./api.ts";
import { CloseIcon } from "./ReaderIcons.tsx";

type Load = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; entries: GlossaryEntry[] };

/**
 * The Book's Glossary (ADR 0170): every name translation has met, most often met first, with the Chinese form it is
 * always translated to. A form can be changed in place (Enter or leaving the field saves it), a name removed or added;
 * after each change the paragraphs on screen are translated again (`onChanged`). Export downloads the Glossary as JSON;
 * Import adds one, keeping the forms the reader set. Names the model decided and the reader has not checked yet are
 * marked, with Keep; any name can be marked "not a name" (ADR 0180), and those words are listed apart, removable. The
 * switch says whether the Reader asks about new names as they come. `version` changes when the Glossary changed
 * elsewhere (translation, the name check), and the list is loaded again. Docked beside the text on a wide window, over
 * it on a narrow one.
 */
export function GlossaryPanel({
  bookId,
  version = 0,
  askNames,
  onAskNames,
  onChanged,
  onClose,
}: {
  bookId: string;
  version?: number;
  askNames: boolean;
  onAskNames(on: boolean): void;
  onChanged(): void;
  onClose(): void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      setLoad({ kind: "ready", entries: await getGlossary(bookId) });
    } catch {
      setLoad({ kind: "failed" });
    }
  }

  useEffect(() => {
    head.current?.focus();
  }, [bookId]);
  useEffect(() => {
    void refresh();
  }, [bookId, version]);

  /** Runs a change, then reloads the list and translates again (unless nothing on screen changes); a refusal is shown, not thrown. */
  async function change(run: () => Promise<unknown>, done: string, retranslate = true): Promise<boolean> {
    try {
      await run();
      setMessage({ text: done, alert: false });
      await refresh();
      if (retranslate) onChanged();
      return true;
    } catch (error) {
      setMessage({ text: error instanceof GlossaryRefusal ? error.message : "The change could not be saved. Check that Verso is running.", alert: true });
      return false;
    }
  }

  async function importFile(file: File) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMessage({ text: `“${file.name}” is not a Glossary exported from Verso.`, alert: true });
      return;
    }
    try {
      const { added, changed, kept } = await importGlossary(bookId, parsed);
      setMessage({ text: `Imported: ${added} added, ${changed} changed${kept ? `, ${kept} of your own forms kept` : ""}.`, alert: false });
      await refresh();
      onChanged();
    } catch (error) {
      setMessage({ text: error instanceof GlossaryRefusal ? error.message : "The Glossary could not be imported.", alert: true });
    }
  }

  const all = load.kind === "ready" ? load.entries : [];
  const entries = all.filter((entry) => !entry.notName);
  const notNames = all.filter((entry) => entry.notName);

  return (
    <aside id="book-glossary" class="reader-panel reader-glossary" aria-labelledby="book-glossary-title" data-no-page-turn>
      <div class="panel-head">
        <h2 id="book-glossary-title" ref={head} tabIndex={-1}>
          Glossary
        </h2>
        <button type="button" class="icon-button" aria-label="Close glossary" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <p class="glossary-intro">Each name in this Book is always translated to the Chinese form listed here. Change one and the text on screen is translated again.</p>
      <label class="glossary-ask">
        <input type="checkbox" checked={askNames} onChange={(event) => onAskNames(event.currentTarget.checked)} />
        Ask about new names as they come
      </label>

      <div class="glossary-tools">
        <a class="glossary-tool" href={glossaryExportUrl(bookId)} download="glossary.json">
          Export
        </a>
        <button type="button" class="glossary-tool" onClick={() => fileInput.current?.click()}>
          Import…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Import a Glossary"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>

      <p class={message?.alert ? "glossary-message alert" : "glossary-message"} role={message?.alert ? "alert" : "status"}>
        {message?.text ?? ""}
      </p>

      <div class="panel-scroll glossary-list">
        {load.kind === "loading" && <p class="glossary-empty">Loading…</p>}
        {load.kind === "failed" && <p class="glossary-empty">The Glossary could not be loaded. Check that Verso is running.</p>}
        {load.kind === "ready" && entries.length === 0 && (
          <p class="glossary-empty">No names yet. They are added as the Book is translated, or you can add one below.</p>
        )}
        {entries.length > 0 && (
          <ul aria-label="Names">
            {entries.map((entry) => (
              <GlossaryRow
                key={entry.key}
                entry={entry}
                onSave={(form) => change(() => setGlossaryEntry(bookId, { name: entry.name, form }), `${entry.name} is now ${form}.`)}
                onKeep={() => change(() => setGlossaryEntry(bookId, { name: entry.name, form: entry.form }), `${entry.name} is kept as ${entry.form}.`, false)}
                onNotName={() => change(() => setGlossaryEntry(bookId, { name: entry.name, notName: true }), `${entry.name} is no longer treated as a name.`)}
                onRemove={() => change(() => deleteGlossaryEntry(bookId, entry.key), `${entry.name} was removed.`)}
              />
            ))}
          </ul>
        )}
        {notNames.length > 0 && (
          <section class="glossary-not-names" aria-labelledby="glossary-not-names-title">
            <h3 id="glossary-not-names-title">Not names</h3>
            <p class="glossary-hint">These words are translated as ordinary words. Remove one to let translation treat it as a name again.</p>
            <ul aria-label="Not names">
              {notNames.map((entry) => (
                <li key={entry.key} class="glossary-row">
                  <span class="glossary-name">{entry.name}</span>
                  <button
                    type="button"
                    class="glossary-remove"
                    aria-label={`Treat ${entry.name} as a name again`}
                    onClick={() => change(() => deleteGlossaryEntry(bookId, entry.key), `${entry.name} may be treated as a name again.`)}
                  >
                    <CloseIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <AddName onAdd={(name, form) => change(() => setGlossaryEntry(bookId, { name, form }), `${name} was added as ${form}.`)} />
      </div>
    </aside>
  );
}

function GlossaryRow({
  entry,
  onSave,
  onKeep,
  onNotName,
  onRemove,
}: {
  entry: GlossaryEntry;
  onSave(form: string): Promise<boolean>;
  onKeep(): void;
  onNotName(): void;
  onRemove(): void;
}) {
  const [form, setForm] = useState(entry.form);
  useEffect(() => setForm(entry.form), [entry.form]);
  const save = () => {
    const next = form.trim();
    if (next && next !== entry.form) void onSave(next).then((ok) => ok || setForm(entry.form));
    else setForm(entry.form);
  };
  return (
    <li class={entry.byReader ? "glossary-row" : "glossary-row unchecked"}>
      <span class="glossary-name">
        {entry.name}
        {!entry.byReader && <span class="glossary-unchecked">not checked</span>}
      </span>
      <input
        class="glossary-form"
        lang="zh-Hans"
        aria-label={`Chinese for ${entry.name}`}
        value={form}
        maxLength={12}
        onInput={(event) => setForm(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          } else if (event.key === "Escape" && form !== entry.form) {
            event.preventDefault();
            event.stopPropagation();
            setForm(entry.form);
          }
        }}
      />
      <div class="glossary-row-actions">
        {!entry.byReader && (
          <button type="button" class="glossary-row-action" aria-label={`Keep ${entry.name} as ${entry.form}`} onClick={onKeep}>
            Keep
          </button>
        )}
        <button type="button" class="glossary-row-action" aria-label={`${entry.name} is not a name`} onClick={onNotName}>
          Not a name
        </button>
      </div>
      <button type="button" class="glossary-remove" aria-label={`Remove ${entry.name}`} onClick={onRemove}>
        <CloseIcon size={16} />
      </button>
    </li>
  );
}

function AddName({ onAdd }: { onAdd(name: string, form: string): Promise<boolean> }) {
  const [name, setName] = useState("");
  const [form, setForm] = useState("");
  return (
    <form
      class="glossary-add"
      aria-label="Add a name"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim() || !form.trim()) return;
        if (await onAdd(name.trim(), form.trim())) {
          setName("");
          setForm("");
        }
      }}
    >
      <h3>Add a name</h3>
      <div class="glossary-add-fields">
        <input aria-label="Name" placeholder="Name" value={name} maxLength={80} onInput={(event) => setName(event.currentTarget.value)} />
        <input aria-label="Chinese" placeholder="中文" lang="zh-Hans" value={form} maxLength={12} onInput={(event) => setForm(event.currentTarget.value)} />
        <button type="submit" class="glossary-tool">
          Add
        </button>
      </div>
    </form>
  );
}
