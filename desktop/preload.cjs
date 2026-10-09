// The desktop app's bridge to the page (issue #34): the Settings screen's "Desktop app" section reads and changes the
// app's own settings and the translation model server through these few calls, and nothing else. The page still has no
// Node; the main process checks that each call comes from Reader's own page. Plain CommonJS: a sandboxed preload
// cannot be a module.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readerDesktop", {
  /** -> {settings, translation: {state, problem, folder}} */
  status: () => ipcRenderer.invoke("desktop:status"),
  /** Changes closeToTray, startWithSystem or startTranslation. -> the new status */
  update: (change) => ipcRenderer.invoke("desktop:update", change),
  /** Asks for the model folder with the system's folder picker. -> the new status */
  chooseModelFolder: () => ipcRenderer.invoke("desktop:choose-model-folder"),
  /** "start" or "stop" the translation model server. -> the new status */
  translation: (action) => ipcRenderer.invoke("desktop:translation", action),
  /** Calls `listener` with the new status whenever it changes. Returns a function that stops listening. */
  onStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("desktop:status", handler);
    return () => ipcRenderer.off("desktop:status", handler);
  },
});
