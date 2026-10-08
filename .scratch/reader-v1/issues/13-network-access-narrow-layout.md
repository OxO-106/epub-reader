# 13: Private network access and narrow layout

**What to build:** By default the server listens on localhost only, with a single explicit option that also makes it listen on the Tailscale address; there is no login. The layout stays usable down to 900 px wide with no fixed widths and nothing that needs hover, so the later mobile pass is polish. When the server cannot be reached a clear message appears. Starting the server and setting the library and data folders is documented.

**Blocked by:** 04 Resume where you stopped

**Status:** ready-for-agent

- [x] Default start accepts connections from this PC only; the option adds the Tailscale address
- [x] No login is required on a permitted address
- [x] At 900 px the Library and the Reader have no horizontal scroll and no clipped controls
- [x] All interactions work without hover
- [x] Stopping the server shows a clear unreachable message in the page
- [x] A short README documents start, folders, and the Tailscale option
- [x] Playwright checks the layout at 900 px
