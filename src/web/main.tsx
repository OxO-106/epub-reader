import { render } from "preact";
import { Library } from "./Library.tsx";
import "./styles.css";

// Two screens eventually: the Library and the Reader. Only the Library exists so far;
// a router (hash-based, so the server needs no per-route handling) is added with the Reader.
render(<Library />, document.getElementById("app")!);
