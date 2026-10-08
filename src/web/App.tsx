import { useEffect, useState } from "preact/hooks";
import { Library } from "./Library.tsx";
import { ReaderScreen } from "./ReaderScreen.tsx";

/** The two screens, chosen by the URL hash so the server needs no per-screen routes: `#/` and `#/read/<book id>`. */
export function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);

  const bookId = /^#\/read\/([0-9a-f]{64})$/.exec(hash)?.[1];
  return bookId ? <ReaderScreen key={bookId} bookId={bookId} /> : <Library />;
}
