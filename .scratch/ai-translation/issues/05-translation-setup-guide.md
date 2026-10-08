# 05: Set-up guide for the laptop and the GPU PC

**What to build:** A short, accurate guide in the README (or a linked docs page) that lets the owner reproduce the set-up: where to get llama.cpp and the model, the exact start command and flags chosen by the benchmark, how to set the three environment variables, how to check it works, how to run the same on the GPU PC (CUDA build, binding behind Tailscale with an API key and firewall rule, or Tailscale Serve), and how to switch the app between the two by changing the URL. Includes known problems and their fixes.

**Blocked by:** 01 Benchmark the local model on this laptop

**Status:** ready-for-agent

- [ ] Every command in the guide has been run (or is clearly marked as untested because no GPU PC was available to the author)
- [ ] The guide states file names, sources and sizes of what has to be downloaded and where to put it
- [ ] A convenience script or batch file starts the model server with the right flags, outside the repository's tracked model files; no model or binary is committed
- [ ] The guide explains the Arc driver workaround and how to read the status pill when something is wrong
