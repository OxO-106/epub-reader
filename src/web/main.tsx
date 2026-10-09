import { render } from "preact";
import { App } from "./App.tsx";
import { applyTheme, loadDisplay } from "./display-settings.ts";
import { declareFontsInPage } from "./fonts.ts";
import "./styles.css";
import "./theme.css";

import { startSharedReading } from "./shared-reading.ts";

applyTheme(loadDisplay().theme);
declareFontsInPage();
render(<App />, document.getElementById("app")!);
// After the first draw: newer reading preferences from another device arrive by the `reader:preferences` event.
startSharedReading();
// The service worker (built with the front end, see vite.config.ts) keeps the app's own files so it starts offline. Only
// in a built app, and only where the browser allows one (https, or this PC's own address).
if (import.meta.env.PROD && "serviceWorker" in navigator && isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Without it the app works as before, online only.
  });
}
