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
