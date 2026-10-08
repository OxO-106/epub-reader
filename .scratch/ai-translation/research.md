# Local English to Simplified Chinese translation backend: research

Date of research: 2026-10-08. Nothing was downloaded, installed or run. Everything below comes from documentation, release pages, model cards and community benchmark threads read through WebFetch and WebSearch.

Conventions used in this file:

- **[verified]** means I opened the cited page and read the claim there.
- **[snippet]** means the claim comes from a search-result summary and I did not open the page myself. Treat it as a lead.
- **[unverified]** means I found no source. It is my estimate or inference, and the arithmetic is shown.
- "Vendor claim" means the model's own authors report it, with no independent replication that I found.

## 0. Versions and dates seen

| Item | Version | Date seen | Source |
|---|---|---|---|
| llama.cpp (latest release) | b11510 | published 2026-10-08 | [GitHub releases API](https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=2) |
| Ollama (latest) | v0.40.1 (v0.40.2-rc0 pre-release on 8 Oct) | 2026-10-07 | [GitHub releases API](https://api.github.com/repos/ollama/ollama/releases/latest), [releases page](https://github.com/ollama/ollama/releases) |
| OpenVINO Model Server (OVMS) | 2026.4.1 (hotfix) | 2026-10-06 | [GitHub releases API](https://api.github.com/repos/openvinotoolkit/model_server/releases/latest) |
| Intel IPEX-LLM | archived, read-only | 2026-01-28 | [repo](https://github.com/intel/ipex-llm) |
| Tencent Hy-MT2 (1.8B, 7B, 30B-A3B) | released | 2026-05-21 | [model card](https://huggingface.co/tencent/hy-mt2-7b), [paper abstract](https://arxiv.org/abs/2605.22064) |
| Google TranslateGemma (4B, 12B, 27B) | report published | 2026-01-13 | [arXiv](https://arxiv.org/abs/2601.09012), [HF card](https://huggingface.co/google/translategemma-12b-it) |
| Qwen3.5 small models (0.8B, 2B, 4B, 9B) | HF repos created | 2026-02-27 | [HF API: Qwen3.5-9B](https://huggingface.co/api/models/Qwen/Qwen3.5-9B), [HF API: Qwen3.5-4B](https://huggingface.co/api/models/Qwen/Qwen3.5-4B) |
| Qwen3.8-27B (dense) | HF repo created | 2026-08-05 | [HF Qwen org listing](https://huggingface.co/api/models?author=Qwen&sort=createdAt&direction=-1&limit=40) |

## 1. Runtime options on Windows 11 with Lunar Lake (Arc 140V iGPU, NPU, CPU)

### 1.1 Summary table

| Runtime | Install effort (no compiler) | Is the Arc 140V used? | OpenAI-compatible streaming | Model format | Main pitfalls |
|---|---|---|---|---|---|
| **llama.cpp, Vulkan build** (`llama-server`) | Very low. Unzip a 33 MB archive. | Yes, via Vulkan. Measured on this exact chip (see 2.1). | Yes (`/v1/chat/completions`, SSE) | GGUF | Intel driver TDR crashes with cooperative-matrix on some drivers (workaround exists); no Intel-official support statement |
| **llama.cpp, SYCL build** | Low. Prebuilt zip (149 MB) that bundles the SYCL runtime. | Yes, in theory. No Windows 140V measurement found. | Yes (same server) | GGUF | Slow first start (JIT); crash report with k-quants on 140V (old, from the archived IPEX-LLM repo) |
| **llama.cpp, OpenVINO build** | Low. Prebuilt zip (89.5 MB). | Yes (iGPU, plus NPU option). | Yes (same server) | GGUF | "Actively under development"; limited model support; NPU has no parallel slots |
| **Ollama** | Low. 1.58 GB installer. | Documented Vulkan path, but Intel on Windows is not mentioned in the docs, and users report CPU fallback on Arc. | Yes | GGUF (own registry, or `hf.co/...`) | Intel iGPU support is the least certain of all options; default context 4096; some request options are not exposed on the OpenAI endpoint |
| **LM Studio** | Low (GUI installer) | Through its llama.cpp Vulkan runtime. Lunar Lake bug report from early 2026. | Yes | GGUF | GUI app, not a headless service by default; no Intel mention in its system requirements |
| **OpenVINO Model Server (OVMS)** | Low to medium. Zip (118 to 140 MB) plus VC++ redistributable. | Yes (GPU), also NPU. Intel's own stack. | Yes | OpenVINO IR (own export, or prebuilt `OpenVINO/...` repos) | Model catalogue is narrower; Qwen3.5 listed under VLM only; no prebuilt Hy-MT2-7B found; no Windows 140V speed figures found |
| **IPEX-LLM Ollama portable zip** | n/a | n/a | n/a | n/a | **Do not use.** Repo archived 2026-01-28; Intel says no support, no fixes, known security issues. |

### 1.2 llama.cpp (Vulkan, SYCL, OpenVINO) with `llama-server`

- Windows release binaries are published for every build. For b11510 the Windows assets are `llama-b11510-bin-win-vulkan-x64.zip` (33,446,147 bytes), `llama-b11510-bin-win-sycl-x64.zip` (148,876,020 bytes), `llama-b11510-bin-win-openvino-2026.4.1-x64.zip` (89,548,149 bytes) and `llama-b11510-bin-win-cpu-x64.zip` (19,485,794 bytes). CUDA builds exist for the NVIDIA PC: `llama-b11510-bin-win-cuda-12.4-x64.zip` (265 MB) plus `cudart-llama-bin-win-cuda-12.4-x64.zip` (391 MB), or the CUDA 13.4 pair (153 MB + 424 MB). [verified, releases API](https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=2)
- `llama-server` options relevant to us ([server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), verified):
  - `--host` defaults to `127.0.0.1`, `--port` to 8080. `--api-key` and `--api-key-file` exist.
  - `-hf <user>/<model>[:quant]` downloads from Hugging Face (default quant Q4_K_M).
  - `--jinja` is on by default. `-rea/--reasoning [on|off|auto]`, `--reasoning-format`, `--reasoning-budget` and `--chat-template-kwargs` control thinking.
  - `-np/--parallel` defaults to auto (-1). `-c` defaults to the model's own context (0).
  - Per-request `chat_template_kwargs` (for example `{"enable_thinking": false}`) is accepted, and `cache_prompt` defaults to true.
  - Reasoning text comes back in a separate `reasoning_content` field.
  - `/health` returns 503 while the model loads and `{"status":"ok"}` when ready.
  - `/v1/chat/completions` supports streaming. The README does not describe the chunk format.
- **Vulkan on Arc 140V works and is measured** (see 2.1). Known pitfall: on Windows 11 with Intel Arc driver 101.8509 (WHQL) and 101.8531 (non-WHQL), the Vulkan backend hit GPU timeout/TDR crashes when `VK_KHR_cooperative_matrix` is used, with several Q4 and Q5 quants. Setting `GGML_VK_DISABLE_COOPMAT=1` avoids it; an older Lenovo driver, 101.7026, was fine. The issue was closed "not planned" and stale, with no upstream fix visible. [verified, issue #20554](https://github.com/ggml-org/llama.cpp/issues/20554)
- A longer Lunar Lake (258V) bug report from January 2026 says Vulkan on this unified-memory platform forces a choice between a stable mode and a mode with roughly 50% lower performance, plus non-deterministic crashes with some parameters. The report says it was written with an AI assistant's help, and I could not open the page, so treat the figures as [snippet, issue #18946](https://github.com/ggml-org/llama.cpp/issues/18946). The practical meaning: pin a known-good Intel driver and test for stability, not only speed.
- **SYCL**: supported hardware includes "built-in Arc GPUs in Meteor Lake, Arrow Lake, and Lunar Lake"; prebuilt Windows zips bundle the runtime, so no oneAPI install is needed to run them. Known issues: no ahead-of-time compilation (slow first start), out-of-memory errors fixable with smaller `-c`, and `SYCL_CACHE_PERSISTENT=1` can crash. [verified, SYCL.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md) A k-quant crash on the 258V's Arc 140V was reported in 2025 against the (now archived) IPEX-LLM repo. [snippet, ipex-llm #12318](https://github.com/intel/ipex-llm/issues/12318)
- **OpenVINO backend** (new): supports Intel CPU, GPU and NPU, validated mainly on Core Ultra Series 1 and 2, with Windows support. It is "actively under development", GGUF Q4_0/Q4_1/Q4_K/Q4_K_M/Q8_0 are supported, Q5_K and Q6_K are converted to Q8_0 at run time, the NPU does not support `llama-server -np > 1`, and stateful execution (recommended for GPU) allows only one chat session. [verified, OPENVINO.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENVINO.md) A Lunar Lake owner measured it (see 2.1) and wrote that it "has limited model support and suffers from bugs".

### 1.3 Ollama

- Current: v0.40.1, 2026-10-07. The Windows installer is `OllamaSetup.exe` at 1,578,290,696 bytes; the standalone zip is 1,468,106,988 bytes. [verified, releases API](https://api.github.com/repos/ollama/ollama/releases/latest)
- GPU docs: Vulkan "is enabled by default when the backend is installed", `OLLAMA_VULKAN=0` disables it, `GGML_VK_VISIBLE_DEVICES` picks devices. On Windows "most GPU vendors' drivers include Vulkan support". Intel is not named in the Windows page, which lists only NVIDIA and AMD. [verified, GPU docs](https://docs.ollama.com/gpu), [Windows docs](https://docs.ollama.com/windows)
- History: Vulkan was opt-in (`OLLAMA_VULKAN=1`) in v0.12.11 and named Intel and integrated GPUs as supported through Vulkan, with a scheduling preference for dedicated GPUs. [verified, v0.12.11 notes](https://github.com/ollama/ollama/releases/tag/v0.12.11)
- Evidence of trouble on Intel (all [snippet, search result list](https://github.com/ollama/ollama/issues/13086) rather than pages I opened): an Intel Community post titled "Ollama is confirmed to be unable to use Intel Arc and is running at 100% CPU" on an Arc 140T Windows laptop ([thread](https://community.intel.com/t5/Intel-Arc-Discrete-Graphics/Ollama-is-confirmed-to-be-unable-to-use-Intel-Arc-and-is-running/m-p/1741721)); Ollama issue #13086 "Vulkan on intel iGPU results in gibberish" ([issue](https://github.com/ollama/ollama/issues/13086)); issue #14207, a Vulkan crash on Intel Arc under Windows ([issue](https://github.com/ollama/ollama/issues/14207)). Whether any of these is fixed in v0.40.x is [unverified].
- The OpenAI-compatible endpoint streams, supports `stream_options.include_usage`, `temperature`, `top_p`, `seed`, `stop`, `max_tokens`, `presence_penalty`, `frequency_penalty`, `reasoning_effort`. It does **not** expose `top_k`, `repeat_penalty` or `num_ctx`; context needs a Modelfile `PARAMETER num_ctx`. [verified, OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- Default context is 4096 tokens (`OLLAMA_CONTEXT_LENGTH`), keep-alive 5 minutes (`OLLAMA_KEEP_ALIVE`), parallel 1 (`OLLAMA_NUM_PARALLEL`). [verified, FAQ](https://docs.ollama.com/faq)
- Any Hugging Face GGUF runs with `ollama run hf.co/{user}/{repo}:{quant}`. [verified](https://huggingface.co/docs/hub/ollama)
- Verdict for the laptop: easiest to install, least certain to use the Arc 140V. Worth a 10 minute test with `ollama ps` (the PROCESSOR column shows GPU or CPU), not worth depending on.

### 1.4 LM Studio

- Runs GGUF through llama.cpp; the Vulkan runtime is how it reaches Arc ([snippet](https://github.com/ggml-org/llama.cpp/issues/18946); the January 2026 Lunar Lake report attached LM Studio 0.3.39 logs). Its system-requirements page mentions x64 with AVX2 and "at least 4GB of dedicated VRAM" and does not mention Intel GPUs. [verified](https://lmstudio.ai/docs/app/system-requirements)
- It has an OpenAI-compatible local server, `lms server start`, and a "Serve on Local Network" option. [verified, docs](https://lmstudio.ai/docs/developer/core/server) Default port, streaming format and headless behaviour were not on the page I read.
- Verdict: fine for hands-on experiments with models; a GUI app is a poor fit as an always-available backend for a web app, and it adds nothing over `llama-server` for Arc.

### 1.5 OpenVINO Model Server (OVMS) and OpenVINO GenAI

- OVMS 2026.4.1 has Windows zips `ovms_windows_2026.4.1_python_off.zip` (118,155,392 bytes) and `..._python_on.zip` (139,758,672 bytes). [verified, releases API](https://api.github.com/repos/openvinotoolkit/model_server/releases/latest) The install page says to install the Microsoft Visual C++ Redistributable first, unzip, and run `setupvars.bat` or `setupvars.ps1` in each new shell; the `python_off` build has reduced chat-template support, no system message in prompts and no tool use, so choose `python_on` for chat. [verified, baremetal guide](https://raw.githubusercontent.com/openvinotoolkit/model_server/main/docs/deploying_server_baremetal.md)
- The LLM quickstart's Windows example: `ovms.exe --source_model OpenVINO/Qwen3-8B-int4-ov --model_repository_path c:\models --rest_port 8000`, then `curl http://localhost:8000/v1/chat/completions`, with `"stream": true` supported. The same quickstart names an Intel iGPU or dGPU as a requirement but does not show a `--target_device` flag; the flag name for choosing GPU must be confirmed in the OVMS parameter docs. [verified, quickstart](https://raw.githubusercontent.com/openvinotoolkit/model_server/main/docs/llm/quickstart.md) Other OVMS pages use the `/v3` path, so confirm the path on the version you install. [snippet](https://docs.openvino.ai/2026/model-server/ovms_demos_continuous_batching.html)
- NPU: the OVMS NPU guide was tested on Meteor Lake, Lunar Lake and Arrow Lake under Windows 11 and processes concurrent requests one after another. [snippet, NPU demo](https://docs.openvino.ai/2025/model-server/ovms_demos_llm_npu.html) I found no tokens/s figure for NPU generation on Lunar Lake, so I do not recommend it.
- Model supply: prebuilt int4 OpenVINO repos exist, for example `OpenVINO/Qwen3-8B-int4-ov` (2025-04-30), `OpenVINO/Qwen3.5-9B-int4-ov` (2026-06-11, Apache-2.0, about 10.9 GB because it also carries vision and MTP parts). No `OpenVINO/` repo for Hunyuan, Hy-MT or TranslateGemma showed up in the listing. [verified, HF listing](https://huggingface.co/api/models?author=OpenVINO&search=Qwen3&limit=40), [Qwen3.5-9B-int4-ov](https://huggingface.co/api/models/OpenVINO/Qwen3.5-9B-int4-ov)
- OpenVINO GenAI's supported-models page lists `HunYuanDenseV1ForCausalLM` with Hy-MT2-1.8B, `Qwen3ForCausalLM` (0.6B to 32B), and Qwen3.5 only under vision-language models (export needs `transformers==5.2`). TranslateGemma is not listed. [verified](https://openvinotoolkit.github.io/openvino.genai/docs/supported-models/) Hy-MT2-7B shares the architecture string (`hunyuan_v1_dense` in its [HF tags](https://huggingface.co/api/models?author=tencent&search=hy-mt2)) but is not listed [unverified whether it exports cleanly].
- Intel's own published OpenVINO LLM figure I found: about 15 tokens/s for Qwen3-8B INT4 on the iGPU of a Core Ultra 7 265H (Arrow Lake H, not Lunar Lake). [snippet, Intel performance index](https://edc.intel.com/content/www/ca/fr/products/performance/benchmarks/intel-core-ultra-processors-series-2_2/)
- Intel AI Playground (MIT licensed) is Intel's own desktop app and uses llama.cpp (Vulkan) and OpenVINO as LLM backends; it lists Core Ultra Series 2 V/H as qualifying hardware. I could not confirm an OpenAI-compatible server in it. [verified, README](https://github.com/intel/AI-Playground)

### 1.6 Recommendation for runtime on the laptop

1. **llama.cpp `llama-server`, Vulkan build** is the recommended default. Reasons: single 33 MB zip with no installer, no compiler; Arc 140V use is demonstrated by a Windows 11 measurement on a Core Ultra 258V (2.1); it is the OpenAI-compatible server the app needs; the same GGUF files and the same API work unchanged on the NVIDIA PC (CUDA zip) and in Ollama. It also gives the full set of sampling parameters, which Ollama's OpenAI endpoint does not.
2. Keep three switches ready: `GGML_VK_DISABLE_COOPMAT=1` (driver crash workaround), `-ngl 0` (CPU fallback), and the SYCL zip as a second GPU backend to compare.
3. Treat Ollama as an optional convenience (quick test only), OVMS as the Intel-blessed alternative worth one benchmark if Vulkan proves unstable, and LM Studio as an experimentation tool.

## 2. Realistic speed

### 2.1 Measured numbers on or near this hardware

| What | Hardware / OS | Backend | Model | pp512 (t/s) | tg128 (t/s) | Source |
|---|---|---|---|---|---|---|
| **Closest match** | Core Ultra 7 258V, Arc 140V, 32 GB LPDDR5X-8533, Windows 11 Pro 25H2, build 9990, 2026-07-13 | Vulkan, FA off | Qwen3-8B Q4_K_M (4.68 GiB, 8.19 B) | 487.58 | 19.17 | [llama.cpp discussion #12570](https://github.com/ggml-org/llama.cpp/discussions/12570) (verified) |
| same | same | Vulkan, FA on | same | 468.43 | 18.98 | same |
| same | same | OpenVINO backend, FA on | same | 1338.94 | 14.55 | same |
| Linux iGPU | Core Ultra 7 258V, Ubuntu 26.04, 2026-06-12, commit 6471e3c | SYCL, FP16, FA off | Llama-2-7B Q4_0 | 535.62 | 24.61 | [discussion #23313](https://github.com/ggml-org/llama.cpp/discussions/23313) (verified; community data, "not independently verified") |
| same | same | SYCL, FA on | same | 245.96 | 25.26 | same |
| Unlabelled Intel rows | "Intel Core Ultra 200 Series" and "300 Series" | Vulkan (device not named) | Llama-2-7B Q4_0 | 865/1380 | 24.4/24.5 | [discussion #10879](https://github.com/ggml-org/llama.cpp/discussions/10879) (verified rows; I cannot tell whether "200 Series" means Lunar Lake) |
| Other iGPU | Arrow Lake H / Meteor Lake | SYCL | Llama-2-7B Q4_0 | n/a | 17 / 16 | [SYCL.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md) |

Comparability notes:

- The Windows/Vulkan Qwen3-8B row is the most relevant: same chip (Core Ultra 7 258V, 32 GB), same OS, a 4-bit 8B model of the kind we would run. It is one user's run with "the most recent Intel drivers" (version not given), so driver variance applies.
- The Linux/SYCL row uses a smaller model (Llama-2-7B Q4_0 is about 3.56 GiB, from my memory of llama-bench output, [unverified]). Scaling by file size: 24.6 × 3.56 / 4.68 ≈ 18.7 t/s, which lines up with the 19.2 t/s Windows/Vulkan figure. This suggests the two backends are close on this chip and that generation is memory-bandwidth bound.
- Bandwidth check: 19.17 t/s × 4.68 GiB ≈ 89.7 GiB/s ≈ 96 GB/s, against a theoretical peak of 8533 MT/s × 16 bytes ≈ 136.5 GB/s (the 128-bit bus width is my assumption; Intel's [ARK page](https://www.intel.com/content/www/us/en/products/sku/240957/intel-core-ultra-7-processor-258v-12m-cache-up-to-4-80-ghz/specifications.html) confirms LPDDR5X-8533 over two channels and 32 GB). That is about 70% of peak, so large further gains from software tuning are unlikely. Speed will scale almost linearly with model file size.
- Generation speed is what dominates a paragraph-by-paragraph job (about 600 output tokens against about 570 input tokens), so prompt-processing differences between backends matter little. OpenVINO's 2.7× faster pp512 does not pay for its slower generation.

### 2.2 CPU-only on Lunar Lake

I found no tokens/s measurement for CPU-only generation on the 258V. What I have:

- Hardware: 4 P-cores plus 4 E-cores, no hyperthreading, 8 threads. [snippet](https://www.notebookcheck.com/Intel-Core-Ultra-7-258V-Prozessor-Benchmarks-und-Specs.893939.0.html)
- A vendor-run AMD comparison says AMD ran the 258V in CPU-only mode because Vulkan GPU offload was slower in LM Studio in 2024. It is old, from a competitor, and predates today's drivers, so it is weak evidence. [snippet](https://www.amd.com/en/blogs/2024/accelerating-llama-cpp-performance-in-consumer-llm.html)
- Estimate [unverified]: the bandwidth ceiling for a 5.03 GB (4.68 GiB) model is 136.5 / 5.03 ≈ 27 t/s. CPU llama.cpp typically reaches well under half to two thirds of that, so I assume **8 to 12 t/s** for generation and perhaps 50 to 100 t/s prompt processing. Treat this as a guess until `llama-bench -ngl 0` is run.

### 2.3 Time to translate one book page

Assumptions (all mine unless noted):

- Input: about 450 source tokens plus about 120 tokens of system prompt and instruction = **570 prompt tokens**. With one previous paragraph pair as context (about 450 + 600 tokens extra), **about 1,570**.
- Output: **500 to 700 tokens**, midpoint 600 (the figures given in the task).
- Time = prompt tokens / pp rate + output tokens / tg rate. Model load time, first-use shader compilation and thermal throttling are excluded.
- Rates for the 8B class come from the measured Vulkan row: pp 488, tg 19.2.
- Rates for the smaller models are scaled by file size (bandwidth bound): tg ≈ 19.2 × 4.68 GiB / size. pp scaled the same way. Results are [unverified].

| Model class (4-bit) | File size | pp (t/s) | tg (t/s) | Prefill, no context | Prefill, with context | Generation, 500 / 600 / 700 tokens | Total for 600 out (no ctx / ctx) |
|---|---|---|---|---|---|---|---|
| 7-8B on Arc 140V, Vulkan (measured basis) | 4.4 to 5.0 GB | 488 | 19.2 | 1.2 s | 3.2 s | 26 / 31 / 36 s | **about 32 s / 34 s** |
| 7-8B on Arc 140V, OpenVINO build | same | 1339 | 14.6 | 0.4 s | 1.2 s | 34 / 41 / 48 s | about 41 s / 42 s |
| 7B Hy-MT2 Q4_K_M (4.62 GB = 4.30 GiB; scaled) | 4.62 GB | about 520 | about 21 | 1.1 s | 3.0 s | 24 / 29 / 33 s | about 30 s / 32 s |
| 9B Qwen3.5 Q4_K_M (6.6 GB per Ollama tag; scaled) | 6.6 GB | about 370 | about 14.6 | 1.5 s | 4.2 s | 34 / 41 / 48 s | about 43 s / 45 s |
| 3-4B (Qwen3.5-4B Q4_K_M, 3.3 GB per Ollama tag; scaled) | 3.3 GB | about 740 | about 29 | 0.8 s | 2.1 s | 17 / 21 / 24 s | **about 22 s / 23 s** |
| 7-8B CPU-only (guess) | 5 GB | 50 to 100 | 8 to 12 | 6 to 11 s | 16 to 31 s | 42 to 88 s | about 50 to 100 s |
| 7-8B on NVIDIA RTX 3060 12 GB (scaled, see below) | 4.6 to 5 GB | thousands | about 57 | under 1 s | about 1 s | 9 / 11 / 12 s | **about 11 s** |
| 7-8B on RTX 4060 Ti 8 GB (scaled) | same | thousands | about 49 | under 1 s | about 1 s | 10 / 12 / 14 s | about 13 s |

Worked example, 8B on the laptop: 570 / 488 = 1.17 s prefill; 600 / 19.17 = 31.3 s generation; total about 32.5 s. With a context pair, 1,570 / 488 = 3.2 s prefill, total about 34.5 s.

NVIDIA scaling basis: CUDA scoreboard rows for Llama-2-7B Q4_0 show tg128 of 75.6 t/s on an RTX 3060 (12 GB) and 63.9 t/s on an RTX 4060 Ti (8 GB). [verified, discussion #15013](https://github.com/ggml-org/llama.cpp/discussions/15013) Multiplying by roughly 0.76 (3.56 / 4.68 GiB) gives about 57 and 49 t/s for an 8B Q4_K_M model [unverified estimate]. Vulkan rows for the same cards on the other scoreboard are 75.9 (RTX 3060) and 59.5 (RTX 4060 Mobile). [verified, discussion #10879](https://github.com/ggml-org/llama.cpp/discussions/10879)

Experience on the laptop: the first characters appear after about 1 to 3 s (after the model is already loaded), then text streams at about 19 tokens/s. A page takes about half a minute to finish, but streaming means the reader sees text immediately; a background queue that translates the next page ahead of the reader would hide most of the wait.

## 3. Models for English to Simplified Chinese literary translation

### 3.1 Evidence quality warning

I found **no independent benchmark of literary English to Chinese translation for any of these models**. The authoritative-looking numbers are automatic metrics on general or news-style test sets (WMT25, FLORES, WMT24++) reported by the model authors. Hy-MT2's own domain benchmark covers finance, law, medical, technology, politics and education, with no literary or fiction domain. [verified, Hy-MT2 paper](https://arxiv.org/html/2605.22064) Any ranking for fiction must therefore come from a small blind comparison on the owner's own books (see 6.4).

### 3.2 Candidate table

| Model | Size / format | Quantised file size | Licence | Quality evidence | Speed class on Arc 140V | Literary style / names |
|---|---|---|---|---|---|---|
| **Tencent Hy-MT2-7B** (`tencent/Hy-MT2-7B`, GGUF: `tencent/Hy-MT2-7B-GGUF`) | 7.5 B dense (`hunyuan-dense`), 262,144 context | Q4_K_M 4,624,648,896 B; Q6_K 6,164,482,720 B; Q8_0 7,981,928,896 B | **Apache-2.0** | Vendor claims: beats open models DeepSeek-V4-Pro and Kimi K2.6 in fast-thinking mode. Table 2: WMT25 XCOMET-XXL 63.86 vs 55.79 for the 397B Qwen3.5-A17B, but lower GEMBA (82.24 vs 83.14). Automatic metrics only. Sources: [model card](https://huggingface.co/tencent/hy-mt2-7b), [paper](https://arxiv.org/html/2605.22064), [GGUF repo API](https://huggingface.co/api/models/tencent/Hy-MT2-7B-GGUF/tree/main) | Fastest of the 7-9B candidates (about 21 t/s estimated) | Official prompt templates for terminology lists, style, background context and delimiters; IFMTBench instruction-following total 83.1 (vendor benchmark). No literary evaluation. |
| **Tencent Hy-MT2-1.8B** (`tencent/Hy-MT2-1.8B-GGUF`) | 1.8 B | file size not read [unverified] | Apache-2.0 | Vendor claim: overall beats Microsoft and Doubao commercial APIs ([paper abstract](https://arxiv.org/abs/2605.22064)) | Fast (estimated 50+ t/s [unverified]) | Likely weaker prose; same prompt features |
| **Tencent Hy-MT2-30B-A3B** (`tencent/Hy-MT2-30B-A3B-GGUF`, created 2026-07-23) | 30 B MoE, 3 B active, arch `hy_v3` | about 18.2 GB (Q4_K_M and Q8_0 files listed; API total 18.24 GB, so probably Q4_K_M only [unverified]) | Apache-2.0 | Vendor claims as above. [HF API](https://huggingface.co/api/models/tencent/Hy-MT2-30B-A3B-GGUF) | Possibly fast because only 3 B parameters are active, but needs about 18 GB of GPU-addressable memory and `hy_v3` support in llama.cpp is [unverified] | Stretch option for the 24 GB NVIDIA box, or a laptop experiment |
| **Tencent Hunyuan-MT-7B** (older, 2025-08/09) | 8.03 B, safetensors; no official GGUF | about 16 GB BF16 | Tencent Hunyuan Community License: **excludes the EU, UK and South Korea**, needs a licence above 100 M MAU, forbids using outputs to improve other models | Vendor claim: first in 30 of 31 language pairs at WMT25 ([card](https://huggingface.co/tencent/Hunyuan-MT-7B/raw/main/README.md), [paper](https://arxiv.org/abs/2509.05209), [licence](https://huggingface.co/tencent/Hunyuan-MT-7B/raw/main/License.txt)) | Same as Hy-MT2-7B | **Superseded by Hy-MT2 with a friendlier licence. Skip.** |
| **Qwen3.5-9B** (`Qwen/Qwen3.5-9B`; Ollama `qwen3.5:9b`, `qwen3.5:9b-q4_K_M`; GGUF `unsloth/Qwen3.5-9B-GGUF`) | 9.65 B hybrid (Gated DeltaNet), multimodal, 262k context, 201 languages | Ollama Q4_K_M 6.6 GB; Q8_0 10 GB | **Apache-2.0** | Vendor claim: WMT24++ (55 languages, XCOMET-XXL) 72.6. Thinking is on by default. ([model card](https://huggingface.co/Qwen/Qwen3.5-9B/raw/main/README.md), [Ollama tags](https://ollama.com/library/qwen3.5/tags), [unsloth repo list](https://huggingface.co/api/models?search=Qwen3.5-9B&author=unsloth&limit=10)) | About 14.6 t/s estimated (hybrid architecture speed on Vulkan is [unverified]) | General LLM: strong at following style or glossary instructions in prose; not translation-tuned. Most likely to add commentary or "thinking" if not configured. |
| **Qwen3.5-4B** | 4.66 B | Ollama Q4_K_M 3.3 GB | Apache-2.0 ([HF API](https://huggingface.co/api/models/Qwen/Qwen3.5-4B)) | No separate translation score read | About 29 t/s estimated | Lighter general fallback |
| **Qwen3-8B** (previous generation; Ollama `qwen3:8b`, `qwen3:8b-q4_K_M` 5.2 GB; `qwen3:4b-instruct-2507-q4_K_M` 2.5 GB) | 8.2 B | 5.2 GB | Apache-2.0 [unverified: I did not open the card] | Measured speed basis (2.1). Quality evidence not collected. | 19.2 t/s measured | Mature and well supported; older than Qwen3.5 ([Ollama tags](https://ollama.com/library/qwen3/tags)) |
| **TranslateGemma 12B / 4B / 27B** (Ollama `translategemma:12b-it-q4_K_M` 8.1 GB, `translategemma:4b-it-q4_K_M` 3.3 GB, `translategemma:27b-it-q4_K_M` 17 GB; HF `google/translategemma-12b-it`) | Gemma 3 based | as listed | Gemma Terms of Use plus Prohibited Use Policy (gated, accept on HF). Ollama page states no licence. | Vendor: gains over Gemma 3 on WMT24++ across all sizes. MetricX/COMET: 4B 5.32/81.6, 12B 3.60/83.5, 27B 3.09/84.4. Human eval on 10 WMT25 pairs. ([HF card](https://huggingface.co/google/translategemma-12b-it), [arXiv](https://arxiv.org/abs/2601.09012), [Ollama](https://ollama.com/library/translategemma/tags)) | 12B Q4 is 8.1 GB: roughly 11 t/s on the laptop [unverified]; fits 12 GB VRAM, tight on 8 GB | Fixed prompt template with language codes (`zh-Hans`); HF card says 2K total input context; no glossary/style slots, so names must be handled in the user text |
| **Seed-X-Instruct-7B** (ByteDance, 2025-07) | 7.5 B, Mistral arch | no official GGUF | OpenMDW (listed as "other") | Vendor: on par with much larger models at WMT25; no numbers on the card. Uses a bare prompt with a `<zh>` tag, no chat template. ([card](https://huggingface.co/ByteDance-Seed/Seed-X-Instruct-7B/raw/main/README.md)) | n/a | Not usable through a chat API without extra work. Skip. |
| **NLLB-200** (`facebook/nllb-200-distilled-600M`) | 0.6 B to 3.3 B seq2seq | 15.8 GB storage for the 600M repo as stored | **CC-BY-NC-4.0** (non-commercial) | Strong on sentence-level, weak on style | Fast | Not a chat model, no glossary, no context. Skip. ([HF API](https://huggingface.co/api/models/facebook/nllb-200-distilled-600M)) |
| **opus-mt-en-zh** (Helsinki-NLP, Marian) | small seq2seq | about 4.07 GB stored (raw repo with several framework copies) | Apache-2.0 | Old (2022), sentence-level | Very fast | Literal output; no glossary or context; not OpenAI-compatible. Skip. ([HF API](https://huggingface.co/api/models/Helsinki-NLP/opus-mt-en-zh)) |
| **Qwen3.6-27B / Qwen3.8-27B** (dense, 2026-04-21 and 2026-08-05) | 27 B | Q4 about 16 to 17 GB (from Qwen3.5-27B Ollama tag as proxy) | Qwen3.6-27B: Apache-2.0 [snippet](https://rits.shanghai.nyu.edu/ai/qwen3-6-27b-a-dense-27b-model-that-beats-a-397b-moe-on-coding); Qwen3.8 licence not read | Not read | About 5 t/s on the laptop [unverified]; 24 GB NVIDIA card only | Candidates for the GPU PC if quality of 7-9B is not good enough ([HF listing](https://huggingface.co/api/models?author=Qwen&sort=createdAt&direction=-1&limit=40)) |

Not selected: Llama-based models (no 2026 evidence collected for Chinese quality; not researched in depth) and the pre-2026 Qwen2.5 line (superseded by Qwen3/3.5).

### 3.3 Recommendation

- **Primary: `tencent/Hy-MT2-7B-GGUF`, file `Hy-MT2-7B-Q4_K_M.gguf` (4.62 GB).** Reasons: translation-specific; Apache-2.0 (no territory limits); official GGUF; the card documents prompt slots for terminology, style and background context, which are what a book needs for consistent names; smaller than the 9B alternative so faster on bandwidth-bound hardware. Biggest caveats: all quality evidence is vendor-reported and automatic; the GGUF card says the files "depend on our STQ kernel" from llama.cpp PR #22836, which is a 1.25-bit quantisation PR that was still open when I looked, so it may only matter for the 1.25-bit file (whether the plain Q4_K_M loads on stock b11510 is [unverified] and is the first thing to test). [verified, GGUF README](https://huggingface.co/tencent/Hy-MT2-7B-GGUF/raw/main/README.md), [PR #22836](https://github.com/ggml-org/llama.cpp/pull/22836)
- **Challenger for literary quality: Qwen3.5-9B Q4_K_M with thinking disabled.** General LLMs sometimes write more natural fiction prose than translation-tuned small models, but this is not shown in the evidence I found; it needs the blind test.
- **Lighter fallback: `tencent/Hy-MT2-1.8B-GGUF`** (same prompts; 1.8 B), with `Qwen3.5-4B` Q4_K_M (3.3 GB) as the general-LLM alternative. Expect plainer prose. Sizes of the 1.8B GGUF files were not read.
- **GPU PC with 8 to 12 GB VRAM:** same files. Hy-MT2-7B Q6_K (6.16 GB) or Q8_0 (7.98 GB) is affordable on 12 GB; on 8 GB use Q4_K_M or Q6_K and a small context. TranslateGemma-12B Q4_K_M (8.1 GB) fits 12 GB. With 24 GB, test Hy-MT2-30B-A3B Q4_K_M (about 18 GB), TranslateGemma-27B, or Qwen3.8-27B.

## 4. Prompting and API pitfalls

### 4.1 System / user prompt patterns

- Hy-MT2 has **no default system prompt** and is meant to receive the instruction as the user message. Official default pattern: "Translate the following text into [target language]. Output only the translated result, with no additional explanation," then the text. Use full language names ("Chinese", not "zh"). Additional templates exist for terminology ("`{src}` translates to `{tgt}`" lines before the instruction), style, delimiters, structured data and background context. [verified, Hy-MT2-7B card](https://huggingface.co/tencent/hy-mt2-7b/raw/main/README.md) For Simplified Chinese, state "Simplified Chinese" explicitly because the model also covers Traditional Chinese and Cantonese.
- Hunyuan-MT (older) uses the Chinese template `把下面的文本翻译成<target_language>，不要额外解释。` for pairs involving Chinese. [verified](https://huggingface.co/tencent/Hunyuan-MT-7B/raw/main/README.md)
- TranslateGemma expects **one user message** with a role line, an output-only line, two blank lines, then the text; for Chinese use `zh-Hans`. [verified, Ollama page](https://ollama.com/library/translategemma) The HF chat template raises an error for unsupported language codes or extra messages. [verified, HF card](https://huggingface.co/google/translategemma-12b-it)
- For a general model (Qwen3.5), use a short system prompt such as:

```text
You are a professional literary translator from English to Simplified Chinese.
Translate the user's passage faithfully, preserving tone, register, rhythm and paragraph structure.
Output ONLY the Chinese translation. No notes, no explanations, no quotation of the source, no preface.
Use the glossary exactly. Never translate text inside <context> tags; it is reference only.
```

and a user message carrying `<glossary>`, optional `<context>` and the `<passage>` (see 4.3).

### 4.2 Avoiding commentary, refusals and thinking text

- **Qwen3.5 thinks by default** and emits a `<think>` block; disable it with `chat_template_kwargs {"enable_thinking": false}` (per request) or `--reasoning off` / `--chat-template-kwargs` on `llama-server`. The card says the old `/think` and `/nothink` switches are not officially supported. [verified, Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B/raw/main/README.md), [llama-server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) On Ollama's OpenAI endpoint the equivalent is `reasoning_effort: "none"`, which maps to `false` for boolean-only models. [verified](https://docs.ollama.com/api/openai-compatibility)
- With `llama-server`, reasoning text is returned in a separate `reasoning_content` field if parsing is on; if you set `--reasoning-format none` the raw text, tags included, ends up in `content`. The app should only display `delta.content`, and should also strip any leading `<think>...</think>` defensively.
- Defensive post-processing in the app: reject or retry when the output (a) starts with phrases like "Here is", "Sure", "以下是", "翻译如下", (b) contains no CJK characters, (c) is far shorter or longer than expected (for example under 0.3× or over 3× the source length in characters), or (d) repeats the same phrase many times.
- Fiction with violence or sexual content can trigger refusals in aligned general models. Translation-tuned models are less likely to refuse; I found no data. Mitigate by retrying with the other model and by logging refusals.

### 4.3 Names, terminology and context

- Maintain a per-book **glossary** (name, place, term to fixed Chinese rendering). Put the entries that appear in the current paragraph in the prompt; do not paste the whole glossary every time. For Hy-MT2 use its terminology template wording; for others use a plain list.
- Pass the **previous paragraph pair** (source and your own stored translation) as reference, clearly marked as not to be translated. This keeps pronouns, tone and names consistent. Keep it to one or two paragraphs: each extra 1,000 tokens costs about 2 s of prefill on the laptop (2.3), and cached prefixes are reused automatically only when the start of the prompt is identical (`cache_prompt` defaults to true in `llama-server`). Put the stable parts (system prompt, glossary) first and the changing parts last.
- First time a proper noun appears, a simple approach is to translate it once, store the pair in the glossary, and reuse it. Consider a pre-pass that extracts candidate names with the same model. This is a design suggestion, not from a source.
- Keep the instruction in the **same language as the model's best templates** (English for Hy-MT2's English template; Hy-MT2 also ships Chinese versions).

### 4.4 Sampling and stopping

| Model | Vendor-recommended sampling | Source |
|---|---|---|
| Hy-MT2-7B / 1.8B | temperature 0.7, top_p 0.6, top_k 20, repetition_penalty 1.05, max_tokens 4096 | [card](https://huggingface.co/tencent/hy-mt2-7b/raw/main/README.md) |
| Qwen3.5-9B, non-thinking | temperature 0.7, top_p 0.8, top_k 20, min_p 0, presence_penalty 1.5 (card also lists variants for reasoning tasks) | [card](https://huggingface.co/Qwen/Qwen3.5-9B/raw/main/README.md) |

- Lower temperature (0.2 to 0.4) is a common practice for faithful translation but is not backed by a source I read; test it in the bake-off. The vendor values are the safe default.
- `repetition_penalty` / `top_k` are not exposed on Ollama's OpenAI endpoint; set them in a Modelfile (`PARAMETER`) instead. In `llama-server` the equivalent names are llama.cpp-specific (`repeat_penalty`, `top_k`) and I did not verify that the OpenAI endpoint accepts them in the request body [unverified]; set them as server defaults if they are ignored.
- Heavy `presence_penalty` (1.5) can distort translations because names and recurring terms must repeat. Treat Qwen's value with suspicion and compare against 0 to 0.5 in the bake-off.
- Stopping: set `max_tokens` to roughly 3 to 4 times the number of source tokens (for example 2,000) rather than 4096, so a runaway loop ends in seconds. No special `stop` strings are needed for Hy-MT2 or Qwen because the chat template's end token already stops generation. Let the app abort the HTTP request if the user leaves the page, which makes `llama-server` stop generating.
- Context window: one paragraph with glossary and a context pair is about 1.5 to 3k tokens, so `-c 4096` suffices, or `-c 8192` for long paragraphs. Do not use the models' full 262k context; it only enlarges the KV cache. `llama-server` with `-np` auto may split the context across several slots, so set **`-np 1`** explicitly; Ollama's default context of 4096 tokens also suffices, but silently truncates anything longer. [README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [Ollama FAQ](https://docs.ollama.com/faq)

### 4.5 Streaming format

- **llama-server and Ollama** both implement `POST /v1/chat/completions` with `"stream": true`. The response is the standard OpenAI server-sent-events format: a series of `data: {json}` lines separated by blank lines, each chunk holding `choices[0].delta.content`, ending with `data: [DONE]` (the OpenAI convention; the llama-server README I read did not spell this out, so check once with `curl -N`). Ollama additionally supports `stream_options: {"include_usage": true}` for a final usage chunk. [verified for Ollama](https://docs.ollama.com/api/openai-compatibility)
- Node 24 can read this with `fetch` and `response.body` as a stream; parse lines starting with `data: `, ignore comment lines, and treat chunks as UTF-8 that may split a multi-byte Chinese character across chunk boundaries (use `TextDecoder` with `{stream: true}`).
- Always send `"model"` (llama-server ignores or maps it; Ollama and OVMS require it). Use `GET /v1/models` as a health check (works on all three, verified for Ollama and OVMS), and `GET /health` on `llama-server`.
- For Ollama, the model is unloaded after 5 minutes of idleness by default (`OLLAMA_KEEP_ALIVE`), which means the first paragraph after a pause pays the load time; `llama-server` keeps the model loaded.

## 5. Remote GPU PC over Tailscale

### 5.1 Exposure options, safest first

| Option | How | Notes |
|---|---|---|
| **A. Tailscale Serve in front of a loopback-only server** | Run `llama-server --host 127.0.0.1 --port 8080 --api-key <key>`; on the same PC `tailscale serve` proxies it to `https://<pc>.<tailnet>.ts.net` | Serve is tailnet-only (unlike Funnel, which is public); the docs recommend keeping the backend bound to localhost; requires HTTPS certificates enabled for the tailnet; access follows your ACLs. [verified, Tailscale Serve docs](https://tailscale.com/docs/features/tailscale-serve) Check the exact flags for running it in the background with `tailscale serve --help`. The app then calls an `https://` URL, which Node supports without changes. |
| **B. Bind to the Tailscale address** | `llama-server --host 100.x.y.z --port 8080 --api-key <key>`; app uses `http://100.x.y.z:8080` | Tailscale IPv4 addresses come from `100.64.0.0/10` and are stable per device. [verified](https://tailscale.com/docs/concepts/tailscale-ip-addresses) Traffic is encrypted by WireGuard inside the tailnet. The server must start after the Tailscale interface is up. |
| **C. Bind to all interfaces** (`--host 0.0.0.0`, or `OLLAMA_HOST=0.0.0.0:11434`) | simplest | Exposes the port to the local LAN as well. Only acceptable with a firewall rule restricting the source (below). |

- `llama-server`: `--host` default `127.0.0.1`, `--port` default 8080, `--api-key` or `LLAMA_API_KEY` for a bearer token. Note `GET /health` is public even with a key. [verified](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- Ollama: binds to 127.0.0.1:11434 by default; `OLLAMA_HOST` changes it; on Windows set it in the user's environment variables and relaunch Ollama. It has **no built-in authentication** (the FAQ has no security section), so rely on Tailscale ACLs plus a firewall rule. [verified](https://docs.ollama.com/faq)
- Firewall: Tailscale itself usually needs no open ports. [snippet](https://tailscale.com/kb/1082/firewall-ports) For option B or C on Windows, add an inbound rule that allows the server's port only from `100.64.0.0/10`, for example with PowerShell's `New-NetFirewallRule` using `-LocalPort`, `-Protocol TCP`, `-Direction Inbound`, `-Action Allow` and `-RemoteAddress 100.64.0.0/10` ([cmdlet reference](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule?view=windowsserver2025-ps); parameter details not individually re-read). Do not create an "any" rule or forward the port on a router. Never use Tailscale Funnel for this service.
- Same files and config? Yes. The GGUF files (Hy-MT2-7B Q4_K_M and others) and the OpenAI-style request work unchanged on the CUDA build of `llama-server` and on Ollama; only the launch flags (`-ngl 99`, larger `-c`, perhaps `-np 2`) and the faster speed differ. Ollama references the same Hugging Face file with `hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M`. The app only needs one configurable base URL, API key and model name.
- Windows CUDA zips for llama.cpp are ready-made: `llama-b11510-bin-win-cuda-12.4-x64.zip` (265 MB) plus the matching `cudart-llama-bin-win-cuda-12.4-x64.zip` (391 MB), or the 13.4 pair; Ollama's installer includes NVIDIA support (driver 551.61 or newer on Windows). [verified](https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=2), [Ollama Windows docs](https://docs.ollama.com/windows) Which CUDA zip fits the PC's driver was not researched.
- **vLLM**: not a good default here. It "does not support Windows natively" (WSL or a community fork is the route) and needs Linux with an NVIDIA GPU of compute capability 7.5 or higher. [verified](https://docs.vllm.ai/en/latest/getting_started/installation/gpu.html) It uses safetensors rather than GGUF, so the model files would differ. It only pays off if the PC is a Linux box serving several simultaneous requests, which a single-reader app does not need.

## 6. Decision

### 6.1 Recommended stacks

| | Laptop (Core Ultra 7 258V, Arc 140V, 31.5 GB) | GPU PC (NVIDIA 8-24 GB, over Tailscale) |
|---|---|---|
| Runtime | `llama-server` from the llama.cpp **Vulkan** zip (b11510 or newer), bound to `127.0.0.1` | `llama-server` from the llama.cpp **CUDA** zip, behind Tailscale Serve (or bound to the Tailscale IP with `--api-key`). On Linux, build or use the matching release. |
| Primary model | `Hy-MT2-7B-Q4_K_M.gguf` (4.62 GB) | Same model at Q6_K or Q8_0 if VRAM allows; with 24 GB also try Hy-MT2-30B-A3B or a 27B model |
| Lighter fallback | `Hy-MT2-1.8B` GGUF or `Qwen3.5-4B` Q4_K_M | `Hy-MT2-7B` Q4_K_M on 8 GB cards |
| API | OpenAI-compatible `/v1/chat/completions`, `stream: true`, `-np 1`, `-c 4096` to `8192` | same |
| Expected speed | about 19 to 21 tokens/s, so about 30 to 35 s per 300-word page; fallback about 20 s | about 50 to 60 tokens/s on an RTX 3060-class card, so about 10 to 14 s per page [unverified estimates, 2.3] |

Expected experience on the laptop: usable for background or ahead-of-reader translation; not instant. A page appears in streaming form within a few seconds and completes in about half a minute. Heavy use will be warm and loud, and CPU/iGPU contention with the reader app itself is possible.

### 6.2 Biggest risks (ranked)

1. **Literary quality is unproven.** No independent literary benchmark was found for any candidate; vendor numbers are on news/general sets. Mitigation: blind test on the owner's own passages (6.4) before committing.
2. **Intel Arc 140V driver instability.** Vulkan TDR crashes on some driver versions and a long Lunar Lake bug report; the only 140V Windows measurement is one user's run with an unspecified driver. Mitigation: record the driver version, try `GGML_VK_DISABLE_COOPMAT=1`, keep CPU mode (`-ngl 0`) and the NVIDIA PC as fallbacks.
3. **Hy-MT2 GGUF compatibility.** The model card ties the GGUF to an STQ kernel PR that was open when I looked. The plain Q4_K_M probably does not need it, but this is untested.
4. **Thermals and sustained speed.** All the quoted speeds are short benchmark runs; a laptop under sustained load may drop. Not measured.
5. **Memory.** Windows gives the iGPU only part of the 31.5 GB as shared GPU memory; the 8B Q4_K_M run succeeded on a 32 GB 258V, but a larger model (27B/30B) is likely to fail or be slow. The share limit was not researched.
6. **Refusals/commentary and name consistency**: manageable with prompt patterns and post-checks (section 4), but require glue code and a glossary store.

### 6.3 Approximate download sizes the owner would need to approve

| Item | Size | Source |
|---|---|---|
| llama.cpp Vulkan zip (b11510) | 33.4 MB | [releases API](https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=2) |
| llama.cpp SYCL zip | 148.9 MB | same |
| llama.cpp OpenVINO zip | 89.5 MB (the OpenVINO runtime may be required separately: [unverified](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENVINO.md)) | same |
| llama.cpp CPU zip | 19.5 MB | same |
| llama.cpp CUDA 12.4 zip + cudart (NVIDIA PC) | 265 MB + 391 MB | same |
| Ollama installer (optional test) | 1.58 GB | [Ollama release](https://api.github.com/repos/ollama/ollama/releases/latest) |
| OVMS Windows zip (optional) | 118 to 140 MB | [OVMS release](https://api.github.com/repos/openvinotoolkit/model_server/releases/latest) |
| `Hy-MT2-7B-Q4_K_M.gguf` | 4.62 GB | [HF tree](https://huggingface.co/api/models/tencent/Hy-MT2-7B-GGUF/tree/main) |
| `HY-MT2-7B-Q6_K.gguf` / `Q8_0.gguf` | 6.16 GB / 7.98 GB | same |
| `Hy-MT2-1.8B` GGUF | not read; I expect about 1 to 2 GB at 4 to 8 bit [unverified] | [repo list](https://huggingface.co/api/models?author=tencent&search=hy-mt2) |
| Qwen3.5-9B Q4_K_M | about 6.6 GB (Ollama tag; the unsloth GGUF size was not read) | [Ollama tags](https://ollama.com/library/qwen3.5/tags) |
| Qwen3.5-4B Q4_K_M | about 3.3 GB (Ollama tag) | same |
| TranslateGemma 12B Q4_K_M / 4B Q4_K_M / 27B Q4_K_M | 8.1 GB / 3.3 GB / 17 GB | [Ollama tags](https://ollama.com/library/translategemma/tags) |
| Hy-MT2-30B-A3B GGUF (24 GB PC only) | about 18 GB for Q4_K_M | [HF API](https://huggingface.co/api/models/tencent/Hy-MT2-30B-A3B-GGUF) |

A first benchmark round needs about 34 MB of runtime plus 4.6 GB of model (Hy-MT2-7B Q4_K_M), then optionally 3.3 GB (Qwen3.5-4B) and 6.6 GB (Qwen3.5-9B), around 15 GB at most. Disk space (520 GB free) is not a concern.

### 6.4 What to benchmark first (commands are not run)

All commands below are **not run**; they are a plan. Exact flag spelling (especially `llama-bench` options) should be checked with `--help` for the downloaded build. Use PowerShell. Create the folders yourself; unpack each download into its own empty directory.

1. Record the environment: Intel graphics driver version (Device Manager or Intel Driver and Support Assistant), Windows version, power mode (plugged in, best performance).
2. Get the runtime (33 MB) and the model (4.6 GB):

```powershell
# download (needs approval)
curl.exe -L -o llama-vulkan.zip https://github.com/ggml-org/llama.cpp/releases/download/b11510/llama-b11510-bin-win-vulkan-x64.zip
Expand-Archive llama-vulkan.zip -DestinationPath .\llama-vulkan
# model (needs approval, 4.62 GB)
curl.exe -L -o Hy-MT2-7B-Q4_K_M.gguf https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main/Hy-MT2-7B-Q4_K_M.gguf
```

3. Confirm the Arc 140V is seen and the model loads (also tests the STQ concern):

```powershell
.\llama-vulkan\llama-server.exe --list-devices
.\llama-vulkan\llama-bench.exe -m .\Hy-MT2-7B-Q4_K_M.gguf -ngl 99 -fa 0,1 -p 512 -n 128
```

   Compare to the reference run: pp512 about 488 and tg128 about 19 t/s for an 8B model. If it crashes or hangs, repeat with `$env:GGML_VK_DISABLE_COOPMAT = "1"`.
4. CPU baseline to fill the unmeasured gap:

```powershell
.\llama-vulkan\llama-bench.exe -m .\Hy-MT2-7B-Q4_K_M.gguf -ngl 0 -t 4,8 -p 512 -n 128
```

5. Start the real server and test streaming with a realistic page (about 450 tokens). Check time to first token, tokens/s, and that nothing but the translation comes back:

```powershell
.\llama-vulkan\llama-server.exe -m .\Hy-MT2-7B-Q4_K_M.gguf -ngl 99 -c 4096 -np 1 --host 127.0.0.1 --port 8080
# in another shell, request body in request.json (messages: one user message with the instruction + passage; stream: true; temperature 0.7; top_p 0.6; top_k 20)
curl.exe -N http://127.0.0.1:8080/v1/chat/completions -H "Content-Type: application/json" -d "@request.json"
```

6. Quality bake-off: take 10 to 15 passages from the owner's real books (dialogue, descriptive prose, names, idioms, a very long sentence), and translate each with Hy-MT2-7B Q4_K_M, Hy-MT2-7B Q6_K, Qwen3.5-9B Q4_K_M (add `--reasoning off` on the server) and optionally TranslateGemma-12B and the 4B fallback. Randomise and blind the outputs, then have the owner pick; record speed and any commentary or refusals.
7. Optional second backend checks, only if step 3 is unstable or slow: the SYCL zip (same commands) and `ollama run hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M` followed by `ollama ps` to see whether Ollama uses the GPU.
8. If a GPU PC exists: repeat steps 3 and 5 there with the CUDA build and `--host`/Tailscale settings from section 5, and compare quality at Q6_K or Q8_0 versus Q4_K_M.

### 6.5 Open questions I could not close

- Windows tokens/s for SYCL on a 258V (only a Linux result exists) and for CPU-only.
- Whether stock llama.cpp b11510 runs `Hy-MT2-7B-Q4_K_M.gguf` without the STQ PR, and the Hy-MT2-1.8B GGUF file sizes.
- Whether recent Ollama (v0.40.x) uses the Arc 140V on Windows.
- How much of the 31.5 GB Windows lets the iGPU address, and sustained-load thermal behaviour.
- Any independent quality comparison of these models on fiction.
