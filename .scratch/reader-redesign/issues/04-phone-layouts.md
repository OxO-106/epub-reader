# 04: Phone layouts (390 px)

**What to build:** The Library and the Reader work as drawn in the MobileLibrary and MobileReader mockups at 390 px wide: a compact Library header with an icon Add button, a compact Continue reading card and a two-column grid; a Reader whose top-bar buttons are icon-only with accessible names, full-width sheets for Contents, Search and Display, and large Previous and Next buttons. Nothing scrolls sideways at 390 px, 360 px or 900 px.

**Blocked by:** 02 Library and empty Library screens, 03 Reader chrome and panels

**Status:** ready-for-agent

- [ ] At 390 px and 360 px the Library and the Reader have no horizontal scroll, no clipped or overlapping controls, and every control is at least 44 px
- [ ] Reader top-bar buttons are icon-only at phone width, each with an accessible name; Contents, Search and Display open as full-width sheets that can be closed
- [ ] The Library is a two-column grid with the compact Continue reading card
- [ ] The generic layout test covers 390 px as well as 900 px and 360 px, over the Library, the empty Library and an open Book with each panel open
- [ ] Existing tests pass; `npm run test:all` passes
