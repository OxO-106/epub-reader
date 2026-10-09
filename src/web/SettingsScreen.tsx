import type { ComponentChildren } from "preact";
import { useEffect, useId, useState } from "preact/hooks";
import { getSettings, restartReader, saveSettings, SettingsRefusal, testTranslation, type SettingInfo, type SettingKey, type SettingsView } from "./api.ts";
import { ConnectionNotice } from "./ConnectionNotice.tsx";
import { ChevronLeft } from "./ReaderIcons.tsx";
import { followsShared, setFollowsShared } from "./shared-reading.ts";
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
        <>
          {view.restartNeeded && <RestartNotice view={view} />}
          <ReadingSection />
          <TranslationSection view={view} onSaved={setView} />
          <LibrarySection view={view} onSaved={setView} />
          <NetworkSection view={view} onSaved={setView} />
          <AboutSection view={view} />
        </>
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

/** Shown while a saved setting waits for Reader to restart: which ones, and a way to restart where the host offers one. */
function RestartNotice({ view }: { view: SettingsView }) {
  const [state, setState] = useState<"idle" | "restarting" | "failed">("idle");
  const names: Partial<Record<SettingKey, string>> = {
    libraryDir: "the library folder",
    host: "who can connect",
    tailscale: "who can connect",
    port: "the port",
  };
  const waiting = [...new Set((Object.keys(view.settings) as SettingKey[]).filter((key) => view.settings[key].pending).map((key) => names[key] ?? key))];

  async function restart() {
    setState("restarting");
    try {
      await restartReader();
      // The server goes away and comes back; reload once it answers again.
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((done) => setTimeout(done, 1000));
        try {
          if ((await fetch("/api/settings", { cache: "no-store" })).ok) {
            location.reload();
            return;
          }
        } catch {
          // still restarting
        }
      }
      setState("failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <div class="settings-restart" role="status">
      <p>
        Restart Reader to apply your changes to {waiting.join(" and ")}.{" "}
        {!view.canRestart && "Stop Reader (Ctrl+C in its window, or Quit in the tray icon’s menu) and start it again."}
        {state === "failed" && " Reader did not come back by itself; start it again by hand."}
      </p>
      {view.canRestart && (
        <button type="button" class="settings-button primary" onClick={restart} disabled={state === "restarting"}>
          {state === "restarting" ? "Restarting…" : "Restart now"}
        </button>
      )}
    </div>
  );
}

/** Save button, outcome line and field errors shared by the smaller sections. */
function useSave(onSaved: (view: SettingsView) => void) {
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function save(changes: Partial<Record<SettingKey, unknown>>, done: (view: SettingsView) => string) {
    setBusy(true);
    setOutcome(null);
    setErrors({});
    try {
      const next = await saveSettings(changes);
      onSaved(next);
      setOutcome({ kind: "ok", text: done(next) });
    } catch (error) {
      if (error instanceof SettingsRefusal && error.key) setErrors({ [error.key]: error.message });
      else setOutcome({ kind: "problem", text: error instanceof SettingsRefusal ? error.message : "Reader could not be reached. Check that it is still running." });
    } finally {
      setBusy(false);
    }
  }
  const clear = (key: SettingKey) => {
    setErrors((now) => ({ ...now, [key]: undefined }));
    setOutcome(null);
  };
  return { errors, busy, outcome, save, clear };
}

const savedNeedsRestart = (next: SettingsView) => (next.restartNeeded ? "Saved. It takes effect when Reader restarts." : "Saved.");

function SaveRow({ busy, outcome }: { busy: boolean; outcome: Outcome }) {
  return (
    <>
      <div class="settings-actions">
        <button type="submit" class="settings-button primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <p role="status" class={`settings-outcome${outcome ? ` ${outcome.kind}` : ""}`}>
        {outcome?.text}
      </p>
    </>
  );
}

function LibrarySection({ view, onSaved }: { view: SettingsView; onSaved(view: SettingsView): void }) {
  const info = view.settings.libraryDir;
  const [folder, setFolder] = useState(String(info.value ?? ""));
  const { errors, busy, outcome, save, clear } = useSave(onSaved);
  return (
    <Section
      title="Library folder"
      description="Books copied into this folder are added to your Library by themselves. Reader makes the folder if it does not exist yet."
    >
      <form
        class="settings-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save({ libraryDir: folder.trim() || null }, savedNeedsRestart);
        }}
      >
        <Field
          name="libraryDir"
          label="Folder"
          hint={"The folder’s full path, such as D:\\Books or /home/me/Books. Leave it empty for the default."}
          info={info}
          value={folder}
          error={errors.libraryDir}
          onInput={(value) => {
            setFolder(value);
            clear("libraryDir");
          }}
        />
        {!info.fixed && <SaveRow busy={busy} outcome={outcome} />}
      </form>
    </Section>
  );
}

type Reach = "local" | "tailscale" | "address";

function NetworkSection({ view, onSaved }: { view: SettingsView; onSaved(view: SettingsView): void }) {
  const s = view.settings;
  const host = String(s.host.value ?? "127.0.0.1");
  const initial: Reach = s.tailscale.value ? "tailscale" : host === "127.0.0.1" || host === "localhost" || host === "::1" ? "local" : "address";
  const [reach, setReach] = useState<Reach>(initial);
  const [address, setAddress] = useState(initial === "address" ? host : "");
  const [port, setPort] = useState(String(s.port.value ?? 5174));
  const { errors, busy, outcome, save, clear } = useSave(onSaved);
  const fixed = s.host.fixed || s.tailscale.fixed;
  const choices: { value: Reach; label: string; hint: string }[] = [
    { value: "local", label: "This PC only", hint: "The safest choice. Other devices cannot connect." },
    { value: "tailscale", label: "This PC and my Tailscale network", hint: "Your phone and other devices on your tailnet can connect. Tailscale must be running." },
    { value: "address", label: "A specific address of this PC", hint: "For example its address on your home network. Anyone who can reach that address can use Reader." },
  ];

  function submit(event: Event) {
    event.preventDefault();
    const changes: Partial<Record<SettingKey, unknown>> = {};
    if (!fixed) {
      changes.tailscale = reach === "tailscale";
      changes.host = reach === "address" ? address.trim() : null;
    }
    if (!s.port.fixed) changes.port = port.trim() || null;
    void save(changes, savedNeedsRestart);
  }

  return (
    <Section
      title="Network"
      description={
        <>
          Who can reach Reader. There is no login: anyone who can reach it can read and change your Library, so only open it to networks you
          trust. See <a href="https://github.com/OxO-106/epub-reader/blob/main/docs/network-access.md">reaching Reader from other devices</a>.
        </>
      }
    >
      <form class="settings-form" noValidate onSubmit={submit}>
        <fieldset class="settings-choices" disabled={fixed}>
          <legend class="settings-label">Who can connect</legend>
          {choices.map((choice) => (
            <label key={choice.value} class="settings-choice">
              <input
                type="radio"
                name="reach"
                value={choice.value}
                checked={reach === choice.value}
                onChange={() => {
                  setReach(choice.value);
                  clear("host");
                }}
              />
              <span>
                <span class="settings-choice-label">{choice.label}</span>
                <span class="settings-hint">{choice.hint}</span>
              </span>
            </label>
          ))}
          {fixed && <p class="settings-note">{fixedNote(s.host.fixed ? "host" : "tailscale", s.host.fixed ? s.host : s.tailscale)}</p>}
        </fieldset>
        {reach === "address" && (
          <Field
            name="host"
            label="Address"
            hint="An IP address of this PC, such as 192.168.1.20."
            info={s.host}
            value={address}
            error={errors.host}
            inputMode="url"
            onInput={(value) => {
              setAddress(value);
              clear("host");
            }}
          />
        )}
        <Field
          name="port"
          label="Port"
          hint="Change it only if another program uses 5174."
          info={s.port}
          value={port}
          error={errors.port}
          inputMode="numeric"
          onInput={(value) => {
            setPort(value);
            clear("port");
          }}
        />
        {!(fixed && s.port.fixed) && <SaveRow busy={busy} outcome={outcome} />}
      </form>
    </Section>
  );
}

function AboutSection({ view }: { view: SettingsView }) {
  return (
    <Section title="About" description="Reader is free software for reading your own books on your own machines.">
      <dl class="settings-about">
        <dt>Version</dt>
        <dd>{view.about.version}</dd>
        <dt>Data folder</dt>
        <dd>
          <code>{view.about.dataDir}</code>
          <span class="settings-hint">Your Library, Reading positions and settings. Back this folder up.</span>
        </dd>
      </dl>
      <p class="settings-links">
        <a href="https://github.com/OxO-106/epub-reader#readme">Documentation</a>
        <a href="https://github.com/OxO-106/epub-reader/issues/new/choose">Report a problem</a>
        <a href="https://github.com/OxO-106/epub-reader/blob/main/CHANGELOG.md">What is new</a>
      </p>
    </Section>
  );
}

/** Whether this device follows the reading preferences shared by all devices (kept in this browser, not on the server). */
function ReadingSection() {
  const [following, setFollowing] = useState(followsShared);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function change(on: boolean) {
    setBusy(true);
    setFollowing(on);
    await setFollowsShared(on); // following again may bring another theme; sharing applies it
    setBusy(false);
    setOutcome({
      kind: "ok",
      text: on ? "This device now uses the shared reading preferences." : "This device now keeps its own reading preferences.",
    });
  }

  return (
    <Section
      title="Reading"
      description="Your theme, font, text size, spacing, margins, layout and the Translate switch are set in the Reader’s Display panel."
    >
      <div class="settings-form">
        <label class="settings-choice settings-toggle">
          <input type="checkbox" checked={following} disabled={busy} onChange={(event) => void change(event.currentTarget.checked)} />
          <span>
            <span class="settings-choice-label">Use the same reading preferences on all devices</span>
            <span class="settings-hint">
              When this is on, a change on this device reaches your other devices that have it on too. Turn it off to keep this device’s own, such
              as larger text on a phone. This choice is kept on this device only.
            </span>
          </span>
        </label>
        <p role="status" class={`settings-outcome${outcome ? ` ${outcome.kind}` : ""}`}>
          {outcome?.text}
        </p>
      </div>
    </Section>
  );
}
