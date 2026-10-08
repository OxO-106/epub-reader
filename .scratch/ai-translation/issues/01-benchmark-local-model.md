# 01: Benchmark the local model on this laptop

**What to build:** Measure whether this laptop can translate fast enough. Run llama-server (llama.cpp Vulkan build b11510, already unpacked in C:\Users\Intel\translation-models) with the downloaded Hy-MT2-7B Q4_K_M model on the Intel Arc 140V, bound to 127.0.0.1, then time real translation of real book pages through its OpenAI-style streaming API: prompt-processing and generation speed, time to first token, and time per 300-word page, with and without the GPU, with flash attention on and off, and with the Vulkan cooperative-matrix workaround if needed. Settle the prompt and generation settings per the model card, and produce quality samples on passages from a few of the owner's own English books (an EPUB, a Markdown file) for a blind side-by-side read. Record everything in a benchmark report and decide: build on the laptop, or point at the GPU PC. If the plain Q4_K_M file will not load on this build, report that and propose the fallback (Qwen3.5-9B Q4_K_M), which needs the owner's approval before any new download.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] llama-server starts on 127.0.0.1 with the model and the Arc GPU is used (device and offload shown in the log)
- [ ] Measured tokens/s for prompt processing and generation, time to first token, and wall-clock time per 300-word page, for the best configuration, with the exact command line recorded
- [ ] A short comparison against CPU-only and against flash attention off, so the chosen flags are justified
- [ ] The prompt and generation settings (system prompt, context handling, temperature and so on) are recorded and produce Chinese-only output with English names kept, no commentary
- [ ] Side-by-side quality samples from at least three passages of the owner's own books are saved in the report for the owner to judge, with the source text and output unedited
- [ ] A clear verdict: 'laptop is fast enough', 'borderline: use a smaller model or accept lag', or 'use the GPU PC', with the numbers behind it
- [ ] The server and any other process started for the benchmark are stopped at the end; nothing large is added to git; any further download is listed (name, source, size) and waits for the owner's approval
