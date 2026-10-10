# Security policy

## Supported versions

Verso is young and released from `main`. Security fixes go into the latest release only; please update before reporting.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: on the repository's **Security** tab choose **Report a vulnerability**, or go straight to <https://github.com/OxO-106/epub-reader/security/advisories/new>. Only the maintainer can read the report.

Include what you found, how to reproduce it (a small Book file or request that triggers it helps), what an attacker could do with it, and the version or commit you tested.

You can expect an acknowledgement within a week. Once the problem is understood we agree on a fix and a disclosure date; you are credited in the advisory unless you prefer not to be.

## What is in scope

Verso runs a server on your own machine and reads files you give it, so the areas that matter most are:

- Opening a Book file (EPUB, Markdown, plain text and any later format) that runs script, reads files it should not, or escapes the Reader's sandbox and Content-Security-Policy.
- The HTTP API: anything that lets a web page on another site, or another device on the network, read or change the Library, or reach files outside Verso's folders.
- The translation proxy: anything that leaks the text being translated, the model server's address or key, or lets a request reach a server other than the configured one.

Verso listens on this PC only unless you choose otherwise, and has no accounts: anyone who can reach the port can use the Library. That is a documented limitation, not a vulnerability, though ideas to improve it are welcome as issues.
