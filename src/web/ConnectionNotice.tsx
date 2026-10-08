import { checkConnection, useServerUnreachable } from "./connection.ts";

/** The message shown, in the Library and in the Reader alike, while the server cannot be reached. Nothing when it can. */
export function ConnectionNotice() {
  const unreachable = useServerUnreachable();
  if (!unreachable) return null;
  return (
    <div role="alert" class="notice connection-notice">
      <p>Cannot reach the server. Check that Reader is still running. This page keeps trying and carries on once it is back.</p>
      <button type="button" onClick={checkConnection}>
        Try again
      </button>
    </div>
  );
}
