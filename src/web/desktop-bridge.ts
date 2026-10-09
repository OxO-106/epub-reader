/**
 * The desktop app's bridge (desktop/preload.cjs), present only when Reader runs inside the desktop app: the Settings
 * screen uses it for the app's own settings and the translation model server.
 */
export type ModelState = "not-set-up" | "stopped" | "starting" | "running" | "failed";

export interface DesktopStatus {
  settings: { closeToTray: boolean; startWithSystem: boolean; modelFolder: string | null; startTranslation: boolean };
  translation: { state: ModelState; problem: string | null };
}

export interface DesktopBridge {
  status(): Promise<DesktopStatus | null>;
  update(change: Partial<Pick<DesktopStatus["settings"], "closeToTray" | "startWithSystem" | "startTranslation">>): Promise<DesktopStatus | null>;
  chooseModelFolder(): Promise<DesktopStatus | null>;
  translation(action: "start" | "stop"): Promise<DesktopStatus | null>;
  onStatus(listener: (status: DesktopStatus) => void): () => void;
}

export const desktopBridge = (): DesktopBridge | null => (globalThis as { readerDesktop?: DesktopBridge }).readerDesktop ?? null;
