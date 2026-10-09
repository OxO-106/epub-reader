<#
.SYNOPSIS
  Starts llama.cpp's llama-server with the translation model, using the settings the benchmark chose
  (.scratch/ai-translation/benchmark.md). Windows PowerShell 5.1 or newer. Run it with `npm run translate:server`
  (extra parameters go after `--`) or directly with `powershell -File scripts\start-translation-server.ps1`.

.DESCRIPTION
  Nothing is downloaded and nothing is copied: the llama.cpp folder and the model file stay wherever you put them
  (outside the repository; see docs/translation-setup.md). The script
    1. checks that llama-server.exe and the model file exist and that the port is free,
    2. starts llama-server (output goes to a log file, path printed),
    3. waits until GET /health answers, then prints the address and the environment variables for the app,
    4. keeps running; Ctrl+C (or closing the window) stops the model server again.

  Where things are looked for, first match wins:
    runtime folder  -RuntimeDir, then $env:READER_LLAMA_DIR, then <repo>\translation-models\llama-vulkan when the model is there, else <home>\translation-models\llama-vulkan
    model file      -ModelPath,  then $env:READER_MODEL_PATH, then <repo>\translation-models\Hy-MT2-7B-Q4_K_M.gguf, else <home>\translation-models\Hy-MT2-7B-Q4_K_M.gguf
    API key         -ApiKey,     then $env:LLAMA_API_KEY (llama-server's own variable), then none

.PARAMETER ListenHost
  Address to listen on. The default 127.0.0.1 means this PC only. On a GPU PC, use "127.0.0.1" behind
  `tailscale serve`, or this PC's Tailscale address (100.x.y.z) together with -ApiKey. A non-loopback address
  without an API key is refused.

.PARAMETER Port
  Default 8080.

.PARAMETER ContextSize
  Prompt plus answer size in tokens (llama-server -c). Default 4096, enough for a paragraph and the paragraph
  before it. A GPU PC can afford more, but a translation never needs more than a few thousand.

.PARAMETER GpuLayers
  Layers placed on the GPU (-ngl). Default 99, which means all of them. Use 0 for CPU only (about 2.5 times slower
  on the laptop).

.PARAMETER ApiKey
  Makes llama-server require "Authorization: Bearer <key>". Passed to the server through the environment, not on
  its command line, so it does not show up in the process list. A value typed after -ApiKey here IS part of this
  script's own PowerShell command line, which other programs can see in the process list: where that matters, set
  $env:LLAMA_API_KEY first and leave -ApiKey out.

.PARAMETER StartupTimeoutSec
  How long to wait for the model to load. Default 180 (the laptop needs about 10 s once the file is in the cache).

.PARAMETER ServerArgs
  Anything else to hand to llama-server unchanged, for example @("-np","2"). Later flags override the defaults.

.EXAMPLE
  npm run translate:server

.EXAMPLE
  npm run translate:server -- -Port 8081 -ContextSize 8192

.EXAMPLE
  .\scripts\start-translation-server.ps1 -RuntimeDir D:\llama-cuda -ModelPath D:\models\Hy-MT2-7B-Q6_K.gguf -ListenHost 100.101.102.103 -ApiKey (Read-Host "key")
#>
[CmdletBinding()]
param(
  [string]$RuntimeDir,
  [string]$ModelPath,
  [string]$ListenHost = "127.0.0.1",
  [int]$Port = 8080,
  [int]$ContextSize = 4096,
  [int]$GpuLayers = 99,
  [string]$ApiKey,
  [int]$StartupTimeoutSec = 180,
  [string[]]$ServerArgs = @()
)

$ErrorActionPreference = "Stop"

function Fail([string]$message) {
  [Console]::Error.WriteLine("start-translation-server: $message")
  exit 1
}

# The repository's own git-ignored translation-models folder when it holds the files, else the one in the home folder.
$repoModels = Join-Path (Split-Path $PSScriptRoot -Parent) "translation-models"
$defaultHome = if (Test-Path (Join-Path $repoModels "Hy-MT2-7B-Q4_K_M.gguf")) { $repoModels } else { Join-Path $HOME "translation-models" }
if (-not $RuntimeDir) { $RuntimeDir = $env:READER_LLAMA_DIR }
if (-not $RuntimeDir) { $RuntimeDir = Join-Path $defaultHome "llama-vulkan" }
if (-not $ModelPath) { $ModelPath = $env:READER_MODEL_PATH }
if (-not $ModelPath) { $ModelPath = Join-Path $defaultHome "Hy-MT2-7B-Q4_K_M.gguf" }
if (-not $ApiKey) { $ApiKey = $env:LLAMA_API_KEY }

# ---- checks -------------------------------------------------------------------------------------------------------
$serverExe = Join-Path $RuntimeDir "llama-server.exe"
if (-not (Test-Path -LiteralPath $serverExe -PathType Leaf)) {
  Fail "llama-server.exe not found in '$RuntimeDir'. Unpack the llama.cpp zip there, or pass -RuntimeDir / set READER_LLAMA_DIR (see docs/translation-setup.md)."
}
if (-not (Test-Path -LiteralPath $ModelPath -PathType Leaf)) {
  Fail "Model file not found: '$ModelPath'. Download it first, or pass -ModelPath / set READER_MODEL_PATH (see docs/translation-setup.md)."
}
if ((Get-Item -LiteralPath $ModelPath).Length -lt 1MB) {
  Fail "Model file '$ModelPath' is almost empty; the download probably did not finish."
}
if ($Port -lt 1 -or $Port -gt 65535) { Fail "Port must be between 1 and 65535." }

$loopback = @("127.0.0.1", "localhost", "::1") -contains $ListenHost
if (-not $loopback -and -not $ApiKey) {
  Fail "Listening on '$ListenHost' reaches other computers, so an API key is required: pass -ApiKey (see the GPU PC section of docs/translation-setup.md)."
}

$listening = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
  Where-Object { $_.Port -eq $Port }
if ($listening) {
  Fail "Port $Port is already in use. If an earlier model server is still running, stop it; otherwise pass -Port with a free port and use the same port in READER_TRANSLATE_URL."
}

# ---- start --------------------------------------------------------------------------------------------------------
$arguments = @(
  "-m", $ModelPath,
  "-ngl", "$GpuLayers",
  "-c", "$ContextSize",
  "-np", "1",
  "--host", $ListenHost,
  "--port", "$Port",
  "--jinja"
) + $ServerArgs

# Arguments are joined into one string for Start-Process (Windows PowerShell 5.1 does not quote array items itself).
$argumentLine = ($arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join " "

$logBase = Join-Path ([System.IO.Path]::GetTempPath()) "reader-llama-server"
$outLog = "$logBase.out.log"
$errLog = "$logBase.err.log"   # llama-server writes its log to stderr

$previousKey = $env:LLAMA_API_KEY
if ($ApiKey) { $env:LLAMA_API_KEY = $ApiKey }

$process = $null
try {
  Write-Host "Starting $serverExe"
  Write-Host "  model: $ModelPath"
  Write-Host "  flags: $argumentLine$(if ($ApiKey) { '  (API key set)' })"
  $process = Start-Process -FilePath $serverExe -ArgumentList $argumentLine -WorkingDirectory $RuntimeDir `
    -NoNewWindow -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  # Reading Handle makes PowerShell 5.1 keep the exit code of a process it did not wait for.
  $null = $process.Handle

  $healthHost = if ($ListenHost -eq "0.0.0.0" -or $ListenHost -eq "::") { "127.0.0.1" } else { $ListenHost }
  $healthUrl = "http://${healthHost}:$Port/health"
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $ready = $false
  Write-Host "Waiting for the model to load (log: $errLog) ..."
  while ($watch.Elapsed.TotalSeconds -lt $StartupTimeoutSec) {
    if ($process.HasExited) {
      Write-Host "--- last lines of the log ---"
      if (Test-Path $errLog) { Get-Content $errLog -Tail 25 }
      Fail "llama-server stopped during start-up (exit code $($process.ExitCode)). See docs/translation-setup.md, section Troubleshooting."
    }
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {
      # 503 while loading, connection refused before the socket is open: keep waiting.
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    Fail "The model server did not become ready within $StartupTimeoutSec s. Look at $errLog."
  }

  $url = if ($loopback) { "http://127.0.0.1:$Port" } else { "http://${ListenHost}:$Port" }
  Write-Host ""
  Write-Host ("Model server ready after {0:N1} s at {1}" -f $watch.Elapsed.TotalSeconds, $url) -ForegroundColor Green
  Write-Host ""
  Write-Host "Start the app with these settings (PowerShell):"
  Write-Host "  `$env:READER_TRANSLATE_URL = `"$url`""
  if ($ApiKey) { Write-Host "  `$env:READER_TRANSLATE_API_KEY = `"<the key you gave>`"" }
  Write-Host "  npm start"
  Write-Host "or in cmd.exe:"
  Write-Host "  set READER_TRANSLATE_URL=$url"
  if ($ApiKey) { Write-Host "  set READER_TRANSLATE_API_KEY=<the key you gave>" }
  Write-Host "  npm start"
  Write-Host ""
  Write-Host "READER_TRANSLATE_MODEL is optional: this server runs one model and ignores the name."
  Write-Host "Leave this window open while you read; Ctrl+C stops the model server."

  while (-not $process.HasExited) { Start-Sleep -Seconds 1 }
  Write-Host "llama-server exited (code $($process.ExitCode)). Log: $errLog"
  exit $process.ExitCode
} finally {
  if ($process -and -not $process.HasExited) {
    Write-Host "Stopping llama-server ..."
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $null = $process.WaitForExit(5000)
  }
  if ($ApiKey) {
    if ($null -eq $previousKey) { Remove-Item Env:\LLAMA_API_KEY -ErrorAction SilentlyContinue } else { $env:LLAMA_API_KEY = $previousKey }
  }
}
