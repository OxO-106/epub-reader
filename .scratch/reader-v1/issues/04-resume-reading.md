# 04: Resume where you stopped

**What to build:** My Reading position is saved automatically as a CFI as I read, and reopening a Book, in the same browser or another device connected to the same server, lands at the same place. The Reader shows how far through the Book I am as a percentage. The Library shows each Book's progress and lists recently read Books first. A Book I have never opened starts at the beginning. One Reading position exists per Book; the latest write wins.

**Blocked by:** 03 Read an EPUB

**Status:** ready-for-agent

- [ ] Reading position is saved without any manual action and survives closing the tab or browser
- [ ] Reopening lands on the identical position, including after a server restart and from a second browser profile
- [ ] Position survives changes to window width (font changes are verified again in ticket 05)
- [ ] Percentage is shown in the Reader and per Book in the Library
- [ ] Library order is most recently read first; never-opened Books start at the beginning
- [ ] API tests cover save and load of a Reading position; a Playwright journey covers close and reopen
