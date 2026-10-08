# 04: Translate button, status and set-up hints

**What to build:** The Reader's top bar gets a Translate toggle (shown only for English Books, remembered per device), a status pill ('Translating ahead', 'Ready', 'Backend unreachable', 'Not set up'), and a clear explanation with set-up hints when translation is not configured or the backend cannot be reached. The bilingual style matches the design board 'Reader, translation on (scrolling)': the English stays the main text, the Chinese is a smaller, tinted gloss in the 京华老宋体 stack, in all three themes, at desktop and phone widths.

**Blocked by:** 03 Reader translation engine

**Status:** ready-for-agent

- [ ] The button appears only for English Books (declared language, or clearly English by the language guess) and its on/off state persists on this device (works with storage blocked)
- [ ] The status pill reflects the engine's states; 'Not set up' and 'Backend unreachable' explain what to do without blocking reading
- [ ] The bilingual style matches the design in light, dark and sepia, is legible (existing contrast rules), and uses the redesign tokens and the Chinese font stack when available
- [ ] The top bar fits at 900 px, 390 px and 360 px with the new controls; the layout test covers it
- [ ] Playwright journeys cover turning Translate on and off, the states of the pill, and the Reading position round trip
