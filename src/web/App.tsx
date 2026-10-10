import { useEffect, useState } from "preact/hooks";
import { Library } from "./Library.tsx";
import { ModelDownload } from "./ModelDownload.tsx";
import { ReaderScreen } from "./ReaderScreen.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";

/** The screens, chosen by the URL hash so the server needs no per-screen routes: `#/`, `#/read/<book id>` and `#/settings`. */
export function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);

  const bookId = /^#\/read\/([0-9a-f]{64})$/.exec(hash)?.[1];
  const screen = bookId ? <ReaderScreen key={bookId} bookId={bookId} /> : hash === "#/settings" ? <SettingsScreen /> : <Library />;
  return (
    <>
      {screen}
      {/* The desktop app's model download, over whichever screen is open. */}
      <ModelDownload />
    </>
  );
}
