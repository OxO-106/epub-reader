# 10: Watched library folder

**What to build:** Files copied into the watched library folder on the PC are imported automatically and appear in the Library, treated exactly like uploads: same format detection, size cap, duplicate detection and error handling. Files already present when the server starts are imported too. My original files are never modified or removed.

**Blocked by:** 02 Import an EPUB and see it in the Library

**Status:** ready-for-agent

- [ ] A file copied into the folder appears in the Library without restarting
- [ ] Files present at server start are imported
- [ ] Duplicates, unsupported, corrupt and oversized files behave as for uploads
- [ ] A failed import is reported somewhere visible
- [ ] Original files in the folder are left untouched
- [ ] API tests use a real temporary library folder
