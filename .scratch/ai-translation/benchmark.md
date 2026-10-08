# Benchmark: local translation on this laptop

Measured 2026-10-08 on the owner's laptop. Ticket: `.scratch/ai-translation/issues/01-benchmark-local-model.md`. Research it follows: `research.md`. Unedited sample output: `benchmark-samples.md`. The script is `scripts/bench-translation.mjs`.

## Set-up

| | |
|---|---|
| Machine | Intel Core Ultra 7 258V (8 cores), 31.5 GB shared memory, Intel Arc 140V integrated GPU (Vulkan reports 18.4 GiB addressable), Windows 11 |
| Runtime | llama.cpp `b11510` (commit c35b66744), Vulkan Windows build, `llama-server.exe`, SHA-256 matched GitHub's published digest |
| Model | Tencent Hy-MT2-7B, `Hy-MT2-7B-Q4_K_M.gguf`, 4,624,648,896 bytes, SHA-256 matched Hugging Face's, Apache-2.0. Loads on stock b11510 (the "depends on an unmerged PR" worry in the model card did not apply to this file) |
| Location | `C:\Users\Intel\translation-models\` (outside the repository) |
| Server command | `llama-server.exe -m Hy-MT2-7B-Q4_K_M.gguf -ngl 99 -c 4096 -np 1 --host 127.0.0.1 --port 8080 --jinja` (ready in about 10 s) |
| Caveat | Other agents were running test suites on the same machine during most measurements, so the numbers are slightly pessimistic and noisy |

## Raw speed (`llama-bench`, 512-token prompt, 128 generated tokens)

| Configuration | Prompt processing | Generation |
|---|---:|---:|
| **GPU (Vulkan), flash attention off (best)** | **756 t/s** | **16.0 t/s** (±4.5, noisy) |
| GPU, flash attention on | 463 t/s | 10.3 t/s |
| GPU, `GGML_VK_DISABLE_COOPMAT=1` (driver workaround) | 139 t/s | 10.8 t/s |
| CPU only, 8 threads | 173 t/s | 6.6 t/s |

The current Arc driver (32.0.101.8826) does not need the cooperative-matrix workaround; leaving it on is about five times faster at prompt processing. Flash attention is slower on this chip.

## Real use: paragraph by paragraph, streaming

A page of Pride and Prejudice, chapter 1: 9 paragraphs, 232 words, translated one paragraph at a time with the previous paragraph as context, as the app will do.

| Run | Wall time for the page | Per 300 words | Time to first character |
|---|---:|---:|---:|
| Final approach (names masked + background context) | 20.0 s | about 26 s | typically 0.3 to 2 s (average about 0.8 s) |
| Other prompt variants | 18 to 28 s | 23 to 36 s | similar |

- Single long paragraphs generate at about 10 to 11 t/s; short ones reach 15 to 18 t/s (variation partly from the machine being busy).
- A typical reader needs about 70 s for 300 English words (250 words per minute), so translation runs at roughly **two to three times reading speed**. With one screenful of look-ahead the translation should stay ahead of the reader, even though the reader will also read the Chinese.

## Verdict: the laptop is fast enough

Build on the laptop. The GPU PC stays a fallback for a bigger or higher-quality model; the app only needs a different URL.

## Quality findings (the part that changed the design)

Measured on four public-domain openings (Pride and Prejudice, Moby-Dick, The Time Machine, Walden). The Chinese is fluent and mostly faithful, with a few mistakes typical of a 7B model (for example "who has taken it" read as "拿走了它" instead of "rented it"; the surrounding paragraphs don't always disambiguate). Read `benchmark-samples.md` and judge.

**English names do not stay English by instruction.** The owner wants English names kept without brackets. The model transliterates them regardless of how it is asked, and it is inconsistent (班纳特先生 and 贝内特先生 for the same Mr. Bennet; 内瑟菲尔德 and 尼瑟菲尔德 for Netherfield). Names kept, out of 9 expected names across the passages:

| Prompt | Names kept |
|---|---:|
| Plain English instruction ("Keep English personal and place names in English") | 0 / 9 |
| Model-card terminology template, each name mapped to itself | 4 / 9 |
| Chinese-language instruction with an explicit rule | 0 / 9 |
| Chinese instruction with an example (the example contained the test names) | 4 / 9 |
| **Names replaced by placeholders (`[[1]]`) before translating, restored afterwards** | **9 / 9** |
| Same with `<n1>` tags | 9 / 9 |

Placeholders were never lost or mangled (0 unrestored tokens in every run), the result is consistent across paragraphs, and speed is unchanged. Adding the previous paragraph as background context neither hurt nor changed speed noticeably. So **the decision is to mask names with placeholders in the translate pipeline** (details in the spec).

Known weakness of the simple name finder used here: capitalised words that are not names get masked and stay in English ("England", "Monday" stayed English in the output). The real implementation needs a stop-list of weekdays, months, countries, languages and nationalities, and should treat names learned elsewhere in the same section as names when they start a sentence.

## Prompt and settings recorded

- No system prompt (the model card puts the instruction in the user message).
- User message when there is context: `[Background Information]` + previous paragraph (masked), then `Please translate the following text into Simplified Chinese, taking the provided background information into consideration. Tokens like [[1]] are names: keep them exactly as written. Note that you must ONLY output the translated result without any additional explanation.` then `[Source Text]` + the paragraph (masked). Without context: `Translate the following text into Simplified Chinese. Tokens like [[1]] are names: keep them exactly as written. Note that you must ONLY output the translated result without any additional explanation:` + paragraph.
- Sampling per the model card: temperature 0.7, top_p 0.6, top_k 20, repeat penalty 1.05, `max_tokens` about 3 to 4 times the source length. `llama-server` accepted `top_k` and `repeat_penalty` in the request body.
- Output was Chinese only, no commentary, in every run.

## Not done

- No passages from the owner's own books (the Library is empty). Drop one or two English books into the app and run `node scripts/bench-translation.mjs`-style comparison again, or tell me which passages to use.
- No second model. If the quality is not good enough, the candidate is Qwen3.5-9B Q4_K_M (about 6.6 GB, Apache-2.0), which needs a new download and your approval. On the GPU PC larger models become possible.
- Temperature other than the vendor default was not compared.
- The GPU PC was not available; nothing was measured on it.

## Cleanup

The benchmark server was stopped; no process from the benchmark is running. Nothing from `C:\Users\Intel\translation-models\` is in git.
