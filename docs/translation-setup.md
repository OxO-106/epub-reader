# Translation set-up guide

How to run the model that translates Books for the Reader, on this PC or on a second PC with an NVIDIA graphics card. The app's own settings (the four `READER_TRANSLATE_*` variables and the two endpoints) are in the README's Translation section. The reasoning behind the choices is in `.scratch/ai-translation/research.md` (what was considered) and `.scratch/ai-translation/benchmark.md` (what was measured on the laptop).

Everything here runs on your own machines. Nothing is sent to a cloud service, and no model or program is stored in the repository.

**What has been run.** Every command in the "On this PC" and "Troubleshooting" sections was run on the laptop it was written on (Windows 11, Intel Core Ultra 7 258V with Arc 140V, Windows PowerShell 5.1). The two download commands were not run again (the files were already on disk and matched the digests); the web addresses in them were checked with a header-only request. The section "On a GPU PC" could not be tried because no such PC was available: it is marked **untested** wherever a step depends on it.

## What you need

| What | File | Size | Where from |
|---|---|---|---|
| llama.cpp, Vulkan build for Windows (works on Intel, AMD and NVIDIA graphics, and on the CPU) | `llama-b11510-bin-win-vulkan-x64.zip` | 33,446,147 bytes (32 MB) | `https://github.com/ggml-org/llama.cpp/releases/download/b11510/llama-b11510-bin-win-vulkan-x64.zip` |
| The translation model, Tencent Hy-MT2-7B, 4-bit (Apache-2.0) | `Hy-MT2-7B-Q4_K_M.gguf` | 4,624,648,896 bytes (4.6 GB) | `https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main/Hy-MT2-7B-Q4_K_M.gguf` |

SHA-256 of both, checked against the copies the benchmark used:

```
llama-b11510-bin-win-vulkan-x64.zip   1137d7ffa61103f651d9d0e3e8f43b97d4df1c2fa44f768bf8275701b4d38891   (GitHub's published digest)
Hy-MT2-7B-Q4_K_M.gguf                 9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b   (Hugging Face's published digest)
```

Newer llama.cpp builds than `b11510` should work as well, but `b11510` is the one the benchmark used and the one this guide was checked with.

### Where to put them

Anywhere outside the repository. The commands below keep the folder in a variable, so change the first line to your own folder:

```powershell
$models = "$HOME\translation-models"        # for example C:\Users\Intel\translation-models
New-Item -ItemType Directory -Force $models | Out-Null
```

The start script looks in `$HOME\translation-models` by default: the runtime unpacked in `llama-vulkan` and the model file next to it. Put things elsewhere and tell the script with `-RuntimeDir` and `-ModelPath`, or with the environment variables `READER_LLAMA_DIR` and `READER_MODEL_PATH` (see "Start the model server").

### Download

The small zip is an ordinary download. In a browser, or:

```powershell
curl.exe -L -o "$models\llama-b11510-bin-win-vulkan-x64.zip" https://github.com/ggml-org/llama.cpp/releases/download/b11510/llama-b11510-bin-win-vulkan-x64.zip
```

The model is large, and Hugging Face drops the connection part-way on the network this was written on ("Recv failure: Connection was reset", four attempts for 4.6 GB). A download that can resume, wrapped in a loop that goes on until the file has the exact size, solved it (the owner's bash version of this is `fetch-model.sh` next to the model files; it is not part of the repository). In PowerShell:

```powershell
$url  = "https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main/Hy-MT2-7B-Q4_K_M.gguf"
$file = "$models\Hy-MT2-7B-Q4_K_M.gguf"
$want = 4624648896
while (-not (Test-Path $file) -or (Get-Item $file).Length -lt $want) {
  curl.exe -L --fail -sS -C - --max-time 600 -o $file $url      # -C - continues where the file stopped
  Start-Sleep -Seconds 2
}
"complete"
```

If the file already has the full size the loop does nothing. Press Ctrl+C to give up; run it again later and it continues.

### Unpack and check

```powershell
Expand-Archive -LiteralPath "$models\llama-b11510-bin-win-vulkan-x64.zip" -DestinationPath "$models\llama-vulkan"
Get-FileHash -Algorithm SHA256 "$models\llama-b11510-bin-win-vulkan-x64.zip", "$models\Hy-MT2-7B-Q4_K_M.gguf" | Format-List Hash, Path
```

The two hashes (shown in capitals) must equal the digests above. `llama-server.exe` must now be directly inside `$models\llama-vulkan`.

## On this PC (the laptop)

### Start the model server

From the repository folder:

```powershell
npm run translate:server
```

This runs `scripts/start-translation-server.ps1` (Windows PowerShell 5.1 or newer). It checks that `llama-server.exe` and the model file exist and that port 8080 is free, starts the server, waits until it answers, then prints the address and the settings for the app. On the laptop it was ready after 3 to 5 s with the model file already in the disk cache (the benchmark saw about 10 s). Keep that window open while you read: Ctrl+C there stops the model server (checked: the script ends and no `llama-server.exe` is left).

The server's own log goes to `%TEMP%\reader-llama-server.err.log`, which is the first place to look when something is wrong.

Options, each as a parameter (after `--` when run through npm, for example `npm run translate:server -- -Port 8081`) or an environment variable:

| Parameter | Environment variable | Default |
|---|---|---|
| `-RuntimeDir` | `READER_LLAMA_DIR` | `$HOME\translation-models\llama-vulkan` |
| `-ModelPath` | `READER_MODEL_PATH` | `$HOME\translation-models\Hy-MT2-7B-Q4_K_M.gguf` |
| `-ListenHost` | | `127.0.0.1` (this PC only) |
| `-Port` | | `8080` |
| `-ContextSize` | | `4096` |
| `-GpuLayers` | | `99` (everything on the graphics chip; `0` is CPU only) |
| `-ApiKey` | `LLAMA_API_KEY` | none |
| `-StartupTimeoutSec` | | `180` |
| `-ServerArgs` | | none; extra flags for llama-server, for example `@("-np","2")` |

The script refuses to listen on any address other than the loopback one without an API key.

The command it runs, with the reason for each flag (the flags are the ones the benchmark used):

```
llama-server.exe -m <model> -ngl 99 -c 4096 -np 1 --host 127.0.0.1 --port 8080 --jinja
```

| Flag | Why |
|---|---|
| `-m` | The model file. |
| `-ngl 99` | Put all layers on the graphics chip. About 2.5 times faster than the CPU alone on the laptop (16 against 6.6 tokens a second). |
| `-c 4096` | Room for a paragraph, the paragraph before it as background and the Chinese answer, with margin. Bigger costs memory and gains nothing for paragraph-sized requests. |
| `-np 1` | One request at a time. The app sends paragraphs one by one (`READER_TRANSLATE_CONCURRENCY` is `1`), and the single slot keeps the whole speed for the paragraph being read. |
| `--host 127.0.0.1` | Only programs on this PC can reach it. The app server is such a program; the browser never talks to the model (ADR 0120). |
| `--port 8080` | The default. Pass `-Port` if something else uses it. |
| `--jinja` | Use the chat template stored in the model file, which is what the model was trained with. |

Flags deliberately not used: flash attention (`-fa`) was slower on this chip (463 against 756 tokens a second for the prompt, 10.3 against 16.0 for the answer).

### Tell the app where it is

The app reads three variables at start. `READER_TRANSLATE_MODEL` can stay unset: `llama-server` serves one model and ignores the name. Set them in the window you start the app from.

PowerShell:

```powershell
$env:READER_TRANSLATE_URL = "http://127.0.0.1:8080"
npm start
```

cmd.exe:

```bat
set READER_TRANSLATE_URL=http://127.0.0.1:8080
npm start
```

With a key (needed only when the model server was started with `-ApiKey`, so in practice for the GPU PC), add `$env:READER_TRANSLATE_API_KEY = "..."` (PowerShell) or `set READER_TRANSLATE_API_KEY=...` (cmd.exe).

To have the variables in every new window, set them once for your Windows user, then open a new window (this works for any of the variables; to undo, pass `$null` instead of the value):

```powershell
[Environment]::SetEnvironmentVariable("READER_TRANSLATE_URL", "http://127.0.0.1:8080", "User")
```

An app that is already running must be restarted to notice a change.

### Check that it works

1. The model server answers (this prints `{"status":"ok"}` once the model is loaded; while it is still loading both addresses answer 503):

   ```powershell
   curl.exe -s http://127.0.0.1:8080/health
   curl.exe -s http://127.0.0.1:8080/v1/models
   ```

   The second prints a JSON description of the model; on the laptop `data[0].id` is the model file's path, which is what the app reports as the model name, and `meta.n_ctx` is the context size (4096). With an API key, `/health` still answers without the key but `/v1/models` needs `-H "Authorization: Bearer <key>"` and otherwise answers `401`.

2. The app sees it (replace 5174 with your port):

   ```powershell
   curl.exe -s http://127.0.0.1:5174/api/translate/status
   ```

   `{"configured":true,"reachable":true,"model":"..."}` is right. `configured:false` means the app was started without `READER_TRANSLATE_URL`; `reachable:false` means it is set but the model server did not answer `/v1/models` within the short timeout. The answer is cached for a few seconds.

3. One real translation. Save the request as `body.json` (a file avoids PowerShell's quote handling):

   ```powershell
   '{"text":"The tea was cold, but she drank it anyway."}' | Out-File -Encoding ascii body.json
   curl.exe -s -H "content-type: application/json" --data-binary "@body.json" http://127.0.0.1:5174/api/translate
   ```

   The answer is a stream, one JSON object per line: `{"delta":"..."}` pieces of Chinese, then `{"done":true}`. Observed on the laptop: a one-sentence paragraph took 1.4 s in total and a two-sentence paragraph with three names 3.0 s; a page of 9 paragraphs takes about 20 s (benchmark).

### The status pill in the Reader

The pill reflects the same status endpoint. Its states, as the spec words them, and what to do:

| Pill | Means | Do |
|---|---|---|
| Not set up | `configured:false`: the app was started without `READER_TRANSLATE_URL` | Set the variable in the window that starts the app and restart it. |
| Backend unreachable | `configured:true`, `reachable:false` | The model server is not running, is still loading (about 4 to 10 s after start), is on another address or port than the URL says, has a different API key, or, for a GPU PC, the tailnet, the Serve or the firewall blocks it. Run the checks above, starting with step 1. |
| Ready | The model server answered and nothing is being translated | Nothing. |
| Translating ahead | Paragraphs are being translated | Nothing. |

(The pill itself is built by the front-end ticket; if its wording differs, the meaning of `configured` and `reachable` above is what counts.)

## Troubleshooting

**The model server crashes and the status goes to "Backend unreachable" (Intel Arc driver).** The research found reports of the Vulkan driver on Intel Arc timing out and taking the process down (look at the end of `%TEMP%\reader-llama-server.err.log`). The driver on the benchmark laptop (32.0.101.8826) did not do this, so no crash was reproduced here and the steps below were only checked to the extent that the server starts and answers with them. In order:

1. Update the Intel graphics driver and start again.
2. Still crashing: turn off the cooperative-matrix path for one start. This is the workaround from the research and it is much slower (prompt processing 139 against 756 tokens a second, answer 10.8 against 16.0), so use it only if the crashes make the default unusable:

   ```powershell
   $env:GGML_VK_DISABLE_COOPMAT = "1"
   npm run translate:server
   ```

   (cmd.exe: `set GGML_VK_DISABLE_COOPMAT=1`.) Close the window or run `Remove-Item Env:GGML_VK_DISABLE_COOPMAT` to go back.
3. Last resort: run on the CPU only, `npm run translate:server -- -GpuLayers 0` (about 6.6 tokens a second, a page takes about a minute).

**Do not turn flash attention on.** It is slower here.

**The model server must keep running.** The app does not start it. If the window with the script is closed, or the PC restarts, translation shows "Backend unreachable" until you run `npm run translate:server` again. (If the script's PowerShell process is killed hard, from Task Manager for instance, the `llama-server.exe` it started is left running and keeps the port; end it with `Stop-Process -Name llama-server`.)

**"Port 8080 is already in use."** An earlier model server is still running (`Get-Process llama-server`, then `Stop-Process -Name llama-server`), or another program has the port. Either free it or use another port in both places: `npm run translate:server -- -Port 8081` and `READER_TRANSLATE_URL=http://127.0.0.1:8081`. The app's own port (5174) is a different setting.

**"llama-server.exe not found" or "Model file not found".** The script prints the folder it looked in. Either move the files there or point the script at them with `-RuntimeDir` and `-ModelPath` (or `READER_LLAMA_DIR` and `READER_MODEL_PATH`).

**The model server stops during start-up.** The script prints the last lines of the log. Typical causes: not enough free memory (close other programs; the model needs about 5 GB), an incomplete model file (compare the size and hash above), or the graphics driver (see the first entry).

**The status is "Backend unreachable" with an API key set.** `/v1/models` answers `401` when the key differs. Compare `READER_TRANSLATE_API_KEY` with the key the server was started with. Observed: with the key missing the app reports `reachable:false`.

## On a GPU PC (untested: no such PC was available)

Nothing in this section has been run. The commands are the ones to try; the facts they rest on are in `.scratch/ai-translation/research.md`, section 5, and the Tailscale and llama.cpp documentation. Tell the project what differs.

The idea: the same model server runs on the PC with the NVIDIA card, the laptop (or any device) keeps running the app, and the app's `READER_TRANSLATE_URL` points at the GPU PC. A faster card allows a bigger model file (6.16 GB for `Q6_K`, 7.98 GB for `Q8_0` of the same model, against 4.62 GB; the research has the sizes, check the exact file names on the model's page on Hugging Face), but the same `Q4_K_M` file works unchanged.

### Install on the GPU PC

1. Install the NVIDIA driver (the CUDA 12.4 build needs a reasonably current one; the research did not establish the exact minimum, so use the latest).
2. Install Tailscale and sign in to the same tailnet as your other devices.
3. Download from the same release page, into one folder (for example `$models\llama-cuda`, both zips unpacked into it so that the `cudart` DLLs sit beside `llama-server.exe`):

   | File | Size |
   |---|---|
   | `llama-b11510-bin-win-cuda-12.4-x64.zip` | 265,091,869 bytes |
   | `cudart-llama-bin-win-cuda-12.4-x64.zip` | 391,443,627 bytes |

   at `https://github.com/ggml-org/llama.cpp/releases/download/b11510/<file name>` (both addresses exist and have these sizes; SHA-256 values were not recorded, GitHub shows the digest on the release page). A 13.4 build exists as well; use it only if your driver is new.
4. Download the model with the loop above (same file).

### Start it, and choose how it is reached

Either start it with the script (copy `scripts/start-translation-server.ps1` to the PC; it needs only PowerShell) or run the command yourself, for example with a larger context since the card can afford it:

```powershell
.\start-translation-server.ps1 -RuntimeDir "$models\llama-cuda" -ModelPath "$models\Hy-MT2-7B-Q4_K_M.gguf" -ContextSize 8192 -ApiKey "<a long random string>"
```

Equivalent command: `llama-server.exe -m <model> -ngl 99 -c 8192 -np 1 --host 127.0.0.1 --port 8080 --jinja --api-key <key>`.

**Option A (preferred): Tailscale Serve in front of a server that only listens on this PC.** The model server stays on `127.0.0.1`. On the GPU PC, once:

```powershell
tailscale serve --bg 8080
tailscale serve status
```

(The flags exist in Tailscale 1.102; the HTTPS certificates feature has to be enabled for the tailnet, and the command tells you if it is not.) The address is `https://<pc-name>.<tailnet-name>.ts.net`, shown by `tailscale serve status`. It is reachable by devices in your tailnet only, subject to your Tailscale access rules. Remove it with `tailscale serve reset`. **Never use `tailscale funnel` for this: Funnel is open to the whole internet.** Whether streaming passes through Serve without delay has not been tried; if the Chinese arrives in one lump at the end instead of piece by piece, use Option B.

**Option B: listen on the PC's Tailscale address, with an API key and a firewall rule.**

```powershell
tailscale ip -4                          # for example 100.101.73.76; this command was run on the laptop
.\start-translation-server.ps1 -RuntimeDir "$models\llama-cuda" -ModelPath "$models\Hy-MT2-7B-Q4_K_M.gguf" -ContextSize 8192 -ListenHost 100.x.y.z -ApiKey "<key>"
```

Start Tailscale before the model server, because the address does not exist otherwise. Then, in a PowerShell opened as administrator, allow the port only from the Tailscale address range (the command was only checked with `-WhatIf` on the laptop, since a rule there would be pointless):

```powershell
New-NetFirewallRule -DisplayName "Reader translation model (Tailscale only)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 -RemoteAddress 100.64.0.0/10
```

Do not create a rule for any address, and do not forward the port on a router. The address is plain `http`, but inside the tailnet the traffic is encrypted by Tailscale. To remove the rule later: `Remove-NetFirewallRule -DisplayName "Reader translation model (Tailscale only)"`.

### Point the app at it

On the laptop (or whichever machine runs the app), in the window that starts it:

```powershell
$env:READER_TRANSLATE_URL = "https://<pc-name>.<tailnet-name>.ts.net"     # Option A
# $env:READER_TRANSLATE_URL = "http://100.x.y.z:8080"                      # Option B
$env:READER_TRANSLATE_API_KEY = "<the same key>"
npm start
```

Check with `curl.exe -s -H "Authorization: Bearer <key>" <url>/v1/models` and the status endpoint from "Check that it works". A phone that opens the Reader through the laptop needs nothing: the laptop's app server is the one talking to the model.

### Switching between the laptop and the GPU PC

Only the address (and the key) changes; the model server on the laptop and the GPU PC speak the same protocol. Stop the app, set `READER_TRANSLATE_URL` to the other address, set or clear `READER_TRANSLATE_API_KEY`, start the app. Keep the laptop's server stopped when you use the GPU PC, as it uses several gigabytes of memory.
