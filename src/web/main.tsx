import { render } from "preact";
import { App } from "./App.tsx";
import { applyTheme, loadDisplay } from "./display-settings.ts";
import "./styles.css";
import "./theme.css";

applyTheme(loadDisplay().theme);

render(<App />, document.getElementById("app")!);
