import type { ComponentChildren } from "preact";
import { useEffect, useId, useState } from "preact/hooks";
import { getSettings, saveSettings, SettingsRefusal, testTranslation, type SettingInfo, type SettingKey, type SettingsView } from "./api.ts";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { ChevronLeft } from "./ReaderIcons.tsx";
import "./settings.css";

/** The environment variable behind each setting, for the note on a setting it fixes. */
const envNames: Record<SettingKey, string> = {
  translateUrl: "READER_TRANSLATE_URL",
  translateModel: "READER_TRANSLATE_MODEL",
  translateApiKey: "READER_TRANSLATE_API_KEY",
  translateConcurrency: "READER_TRANSLATE_CONCURRENCY",
  libraryDir: "READER_LIBRARY_DIR",
  host: "READER_HOST",
  tailscale: "READER_TAILSCALE",
  port: "READER_PORT",
};

function fixedNote(key: SettingKey, info: SettingInfo): string | null {
  if (info.source === "environment") return `Set by the ${envNames[key]} environment variable, so it cannot be changed here.`;
  if (info.source === "app") return "Set by the app running Reader, so it cannot be changed here.";
  return null;
}

/**
 * The Settings screen (`#/settings`): how Reader runs, saved by the server (see src/server/settings.ts). Sections save
 * on their own; a setting fixed by an environment variable or the hosting app is shown but cannot be edited.
 */
export function SettingsScreen() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getSettings().then(setView, () => setFailed(true));
  }, []);

  return (
    <main class="settings">
      <header class="settings-header">
        <a class="settings-back" href="#/">
          <ChevronLeft size={20} />
          <span>Library</span>
        </a>
      </header>
      <h1>Settings</h1>
      <ConnectionNotice />
      {view ? (
        <TranslationSection view={view} onSaved={setView} />
      ) : failed ? (
        <p role="alert" class="settings-message">
          The settings could not be loaded. Check that Reader is still running, then reload this page.
        </p>
      ) : (
        <p role="status" class="settings-message">
          Loading…
        </p>
      )}
    </main>
  );
}

function Section({ title, description, children }: { title: string; description: ComponentChildren; children: ComponentChildren }) {
  const id = useId();
  return (
    <section class="settings-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p class="settings-description">{description}</p>
      {children}
    </section>
  );
}

/** A labelled text field with its hint, its error, and the note when the setting is fixed. */
function Field({
  name,
  label,
  hint,
  info,
  value,
  error,
  type = "text",
  inputMode,
  placeholder,
  onInput,
}: {
  name: SettingKey;
  label: string;
  hint?: string;
  info: SettingInfo;
  value: string;
  error?: string;
  type?: "text" | "password";
  inputMode?: "numeric" | "url";
  placeholder?: string;
  onInput(value: string): void;
}) {
  const id = `setting-${name}`;
  const note = fixedNote(name, info);
  const described = [hint && `${id}-hint`, note && `${id}-note`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const props = {
    id,
    inputMode,
    value,
    placeholder,
    readOnly: info.fixed,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described,
    autocomplete: "off",
    spellcheck: false,
    onInput: (event: Event) => onInput((event.currentTarget as HTMLInputElement).value),
  };
  return (
    <div class="settings-field">
      <label for={id}>{label}</label>
      {type === "password" ? <input type="password" {...props} /> : <input type="text" {...props} />}
      {hint && (
        <p class="settings-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {note && (
        <p class="settings-note" id={`${id}-note`}>
          {note}
        </p>
      )}
      {error && (
        <p class="settings-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

type Outcome = { kind: "ok" | "problem"; text: string } | null;

function TranslationSection({ view, onSaved }: { view: SettingsView; onSaved(view: SettingsView): void }) {
  const s = view.settings;
  const [url, setUrl] = useState(String(s.translateUrl.value ?? ""));
  const [model, setModel] = useState(String(s.translateModel.value ?? ""));
  const [concurrency, setConcurrency] = useState(String(s.translateConcurrency.value ?? 1));
  // A new key typed in, and whether the saved one is being replaced or removed.
  const [apiKey, setApiKey] = useState("");
  const [keyAction, setKeyAction] = useState<"keep" | "replace" | "remove">(s.translateApiKey.set ? "keep" : "replace");
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const changed = (key: SettingKey, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((now) => ({ ...now, [key]: undefined }));
    setOutcome(null);
  };

  function refusal(error: unknown) {
    if (error instanceof SettingsRefusal && error.key) setErrors({ [error.key]: error.message });
    else if (error instanceof SettingsRefusal) setOutcome({ kind: "problem", text: error.message });
    else setOutcome({ kind: "problem", text: "Reader could not be reached. Check that it is still running." });
  }

  async function test() {
    setBusy("test");
    setOutcome(null);
    try {
      const result = await testTranslation({ url, model, apiKey: keyAction === "replace" ? apiKey : undefined });
      setOutcome(
        result.reachable
          ? { kind: "ok", text: result.model ? `The model server answered. It serves ${result.model}.` : "The model server answered." }
          : { kind: "problem", text: "No model server answered at this address. Check that it is running and that the address and key are right." },
      );
    } catch (error) {
      refusal(error);
    } finally {
      setBusy(null);
    }
  }

  async function save(event: Event) {
    event.preventDefault();
    setBusy("save");
    setOutcome(null);
    const changes: Partial<Record<SettingKey, unknown>> = {};
    if (!s.translateUrl.fixed) changes.translateUrl = url.trim() || null;
    if (!s.translateModel.fixed) changes.translateModel = model.trim() || null;
    if (!s.translateConcurrency.fixed) changes.translateConcurrency = concurrency.trim() || null;
    if (!s.translateApiKey.fixed) {
      if (keyAction === "remove") changes.translateApiKey = null;
      else if (keyAction === "replace" && apiKey.trim()) changes.translateApiKey = apiKey;
    }
    try {
      const next = await saveSettings(changes);
      onSaved(next);
      setApiKey("");
      setKeyAction(next.settings.translateApiKey.set ? "keep" : "replace");
      setOutcome({
        kind: "ok",
        text: next.settings.translateUrl.value ? "Saved. Translation uses these settings now." : "Saved. Translation is off until a model server's address is set.",
      });
    } catch (error) {
      refusal(error);
    } finally {
      setBusy(null);
    }
  }

  const keyInfo = s.translateApiKey;
  const keyNote = fixedNote("translateApiKey", keyInfo);
  const testable = url.trim() !== "";

  return (
    <Section
      title="Translation"
      description={
        <>
          Reader can show a Chinese translation under each English paragraph, written by a model server you run yourself (llama.cpp,
          Ollama, LM Studio or vLLM). Changes apply at once. The <a href="https://github.com/OxO-106/epub-reader/blob/main/docs/translation-setup.md">set-up guide</a> explains
          how to run one.
        </>
      }
    >
      <form class="settings-form" onSubmit={save} noValidate>
        <Field
          name="translateUrl"
          label="Model server address"
          hint="Leave empty to turn translation off."
          info={s.translateUrl}
          value={url}
          error={errors.translateUrl}
          inputMode="url"
          placeholder="http://127.0.0.1:8080"
          onInput={changed("translateUrl", setUrl)}
        />
        <Field
          name="translateModel"
          label="Model name"
          hint="Only needed when the server holds more than one model."
          info={s.translateModel}
          value={model}
          error={errors.translateModel}
          onInput={changed("translateModel", setModel)}
        />

        <div class="settings-field">
          {keyAction === "keep" ? (
            <>
              <span class="settings-label" id="setting-translateApiKey-label">
                API key
              </span>
              <div class="settings-key" aria-labelledby="setting-translateApiKey-label" role="group">
                <span class="settings-key-state">A key is saved.</span>
                {!keyInfo.fixed && (
                  <>
                    <button type="button" class="settings-button quiet" onClick={() => setKeyAction("replace")}>
                      Replace
                    </button>
                    <button type="button" class="settings-button quiet" onClick={() => setKeyAction("remove")}>
                      Remove
                    </button>
                  </>
                )}
              </div>
              {keyNote && <p class="settings-note">{keyNote}</p>}
            </>
          ) : keyAction === "remove" ? (
            <>
              <span class="settings-label">API key</span>
              <div class="settings-key" role="group" aria-label="API key">
                <span class="settings-key-state">The saved key will be removed when you save.</span>
                <button type="button" class="settings-button quiet" onClick={() => setKeyAction("keep")}>
                  Keep it
                </button>
              </div>
            </>
          ) : (
            <Field
              name="translateApiKey"
              label="API key"
              hint={keyInfo.set ? "The new key replaces the saved one when you save." : "Only for model servers that ask for one. It is never shown again."}
              info={keyInfo}
              value={apiKey}
              error={errors.translateApiKey}
              type="password"
              onInput={changed("translateApiKey", setApiKey)}
            />
          )}
        </div>

        <Field
          name="translateConcurrency"
          label="Paragraphs at once"
          hint="How many paragraphs the model server works on together. Keep 1 unless your server is set up for more."
          info={s.translateConcurrency}
          value={concurrency}
          error={errors.translateConcurrency}
          inputMode="numeric"
          onInput={changed("translateConcurrency", setConcurrency)}
        />

        <div class="settings-actions">
          <button type="button" class="settings-button" onClick={test} disabled={busy !== null || !testable}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button type="submit" class="settings-button primary" disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
        <p role="status" class={`settings-outcome${outcome ? ` ${outcome.kind}` : ""}`}>
          {outcome?.text}
        </p>
      </form>
    </Section>
  );
}
