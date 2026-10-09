# The Chinese font's original ships in the repository; its web pieces are still generated

Supersedes the "never committed" part of ADR 0100. The owner decided to commit the original 京华老宋体 file (`assets/fonts/KingHwa_OldSong-2.002.ttf`, version 2.002, 35 MB), so a fresh checkout has the font without it being installed on the PC. The font's own copyright line is still "Copyright 2022 TerryWang. All rights reserved."; the owner took that decision knowing it, and the repository is public.

Everything else in ADR 0100 stands. `npm run fonts:build` now reads the repository's copy first (and the installed copy only when it is missing) and still writes the woff2 pieces, style sheet and manifest to the git-ignored `./fonts`, since they are generated output that the build can always remake; the server serves that folder at `/fonts/` and the front end declares the pieces as "KingHwa Web" only when they are there. Tests still use the tiny generated stand-in, never the real font.
