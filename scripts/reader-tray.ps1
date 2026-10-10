<#
.SYNOPSIS
  Starts the Reader server and the translation model server and keeps a system-tray icon that shows whether
  both are active. Windows PowerShell 5.1 or newer. Normally started by double-clicking `Start Reader.cmd`.

.DESCRIPTION
  The tray icon is two dots: the left one is the Reader, the right one is Translation.
    green  = running and answering        amber = starting (the model takes a few seconds to load)
    red    = stopped or not answering     grey  = not set up / switched off
  Hover over the icon for the words ("Verso: running | Translation: running"). Double-click opens the Reader in the
  browser. Right-click for: Open Reader, restart either server, open the logs folder, Quit (stops both servers).

  What it starts, both hidden:
    Reader       `npm start` in the repository (http://127.0.0.1:<AppPort>), with READER_TRANSLATE_URL pointing at
                 the model server so the Translate button works
    Translation  llama-server.exe with the model, using the benchmark's flags (the same as
                 scripts\start-translation-server.ps1), bound to 127.0.0.1 only

  If a server is already running on its port and answers, it is used as it is and left running when you quit
  (the tray only stops what it started). If the model or llama.cpp is not where it is expected, the Reader still
  starts and Translation shows grey "not set up".

  Where things are looked for, first match wins:
    runtime folder  -RuntimeDir, then $env:READER_LLAMA_DIR, then <repo>\translation-models\llama-vulkan when the model is there, else <home>\translation-models\llama-vulkan
    model file      -ModelPath,  then $env:READER_MODEL_PATH, then <repo>\translation-models\Hy-MT2-7B-Q4_K_M.gguf, else <home>\translation-models\Hy-MT2-7B-Q4_K_M.gguf
    Reader port     -AppPort,    then $env:READER_PORT,       then 5174

  Logs: %LOCALAPPDATA%\Reader\logs (overwritten at every start). They hold server messages, not Book text.
  Status for scripts: %LOCALAPPDATA%\Reader\status.json.

.PARAMETER NoTranslation
  Start only the Reader (no model server, no READER_TRANSLATE_URL).

.PARAMETER Stop
  Ask a running tray to quit (which stops the servers it started), and wait for it. This is what
  `Stop Reader.cmd` does.

.PARAMETER IconPreview
  Writes PNG pictures of the tray icon in each state into the given folder and exits. For checking the look.

.EXAMPLE
  .\scripts\reader-tray.ps1

.EXAMPLE
  .\scripts\reader-tray.ps1 -Stop
#>
[CmdletBinding()]
param(
  [string]$RepoDir,
  [string]$RuntimeDir,
  [string]$ModelPath,
  [int]$AppPort = 0,
  [int]$LlamaPort = 8080,
  [int]$ContextSize = 4096,
  [int]$GpuLayers = 99,
  [switch]$NoTranslation,
  [switch]$Stop,
  [string]$IconPreview
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

# Must happen before any control (the tray icon) exists: a UI error is logged instead of opening a dialog.
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)

Add-Type -Namespace ReaderTray -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool DestroyIcon(System.IntPtr handle);
'@

# ---- settings -----------------------------------------------------------------------------------------------------
if (-not $RepoDir) { $RepoDir = Split-Path -Parent $PSScriptRoot }
if ($AppPort -le 0) { $AppPort = if ($env:READER_PORT) { [int]$env:READER_PORT } else { 5174 } }
# The repository's own git-ignored translation-models folder when it holds the files, else the one in the home folder.
$repoModels = Join-Path (Split-Path $PSScriptRoot -Parent) "translation-models"
$defaultHome = if (Test-Path (Join-Path $repoModels "Hy-MT2-7B-Q4_K_M.gguf")) { $repoModels } else { Join-Path $HOME "translation-models" }
if (-not $RuntimeDir) { $RuntimeDir = $env:READER_LLAMA_DIR }
if (-not $RuntimeDir) { $RuntimeDir = Join-Path $defaultHome "llama-vulkan" }
if (-not $ModelPath) { $ModelPath = $env:READER_MODEL_PATH }
if (-not $ModelPath) { $ModelPath = Join-Path $defaultHome "Hy-MT2-7B-Q4_K_M.gguf" }

$readerUrl = "http://127.0.0.1:$AppPort"
$stateDir = Join-Path $env:LOCALAPPDATA "Reader"
$logDir = Join-Path $stateDir "logs"
$mutexName = "Local\ReaderTrayLauncher"
$quitEventName = "Local\ReaderTrayQuit"

# ---- icon ---------------------------------------------------------------------------------------------------------
$colors = @{
  running  = [System.Drawing.Color]::FromArgb(46, 158, 107)
  starting = [System.Drawing.Color]::FromArgb(230, 168, 32)
  stopped  = [System.Drawing.Color]::FromArgb(214, 69, 69)
  error    = [System.Drawing.Color]::FromArgb(214, 69, 69)
  notsetup = [System.Drawing.Color]::FromArgb(140, 146, 142)
  off      = [System.Drawing.Color]::FromArgb(140, 146, 142)
}

function New-StatusBitmap([string]$left, [string]$right, [int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $diameter = [int][math]::Round($size * 0.43)   # leaves a gap between the dots, still visible at 16 px
    $top = [int][math]::Round(($size - $diameter) / 2)
    $margin = [int][math]::Max(1, [math]::Round($size * 0.03))
    $edge = [math]::Max(1.0, $size / 16.0)
    $dots = @(@($margin, $left), @(($size - $diameter - $margin), $right))
    foreach ($dot in $dots) {
      $brush = New-Object System.Drawing.SolidBrush $colors[$dot[1]]
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(150, 20, 24, 22)), ([single]$edge)
      try {
        $g.FillEllipse($brush, [int]$dot[0], $top, $diameter, $diameter)
        $g.DrawEllipse($pen, [int]$dot[0], $top, $diameter, $diameter)
      } finally { $brush.Dispose(); $pen.Dispose() }
    }
  } finally { $g.Dispose() }
  return $bitmap
}

if ($IconPreview) {
  New-Item -ItemType Directory -Force -Path $IconPreview | Out-Null
  foreach ($pair in @(@("running", "running"), @("starting", "starting"), @("running", "starting"), @("running", "notsetup"), @("error", "running"), @("stopped", "error"))) {
    $bitmap = New-StatusBitmap $pair[0] $pair[1] 128
    $bitmap.Save((Join-Path $IconPreview "icon-$($pair[0])-$($pair[1]).png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
  }
  Write-Host "Icon pictures written to $IconPreview"
  exit 0
}

# ---- -Stop: ask the running tray to quit ---------------------------------------------------------------------------
if ($Stop) {
  $quit = $null
  if (-not [System.Threading.EventWaitHandle]::TryOpenExisting($quitEventName, [ref]$quit)) {
    Write-Host "The Verso tray is not running."
    exit 0
  }
  $null = $quit.Set()
  $quit.Dispose()
  for ($i = 0; $i -lt 100; $i++) {
    Start-Sleep -Milliseconds 200
    $probe = $null
    if (-not [System.Threading.EventWaitHandle]::TryOpenExisting($quitEventName, [ref]$probe)) { Write-Host "Stopped."; exit 0 }
    $probe.Dispose()
  }
  Write-Host "The tray did not quit within 20 seconds."
  exit 1
}

# ---- one tray only ------------------------------------------------------------------------------------------------
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
  # Already running: just open the Reader, like clicking the icon.
  Start-Process $readerUrl
  exit 0
}
$quitEvent = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::ManualReset, $quitEventName)

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$script:TrayLog = Join-Path $logDir "tray.log"
function Write-TrayLog([string]$message) {
  try { Add-Content -LiteralPath $script:TrayLog -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $message) } catch {}
}
[System.Windows.Forms.Application]::add_ThreadException({ param($sender, $e) Write-TrayLog "ui error: $($e.Exception.Message)" })
Set-Content -LiteralPath $script:TrayLog -Value ("{0:u} reader-tray started; repo {1}" -f (Get-Date), $RepoDir)

# ---- services -----------------------------------------------------------------------------------------------------
$script:Http = New-Object System.Net.Http.HttpClient
$script:Http.Timeout = [TimeSpan]::FromSeconds(2)

function New-Service([string]$name, [string]$healthUrl, [int]$graceSec) {
  return @{
    Name = $name; Url = $healthUrl; GraceSec = $graceSec
    Proc = $null; Owned = $false; State = "off"; Prev = "off"; Detail = ""
    Healthy = $false; EverHealthy = $false; Fails = 0; StartedAt = [DateTime]::MinValue; Task = $null
  }
}

$script:TranslationEnabled = -not $NoTranslation
$script:Reader = New-Service "Verso" "$readerUrl/api/books" 90
$script:Translation = New-Service "Translation" "http://127.0.0.1:$LlamaPort/health" 180
if (-not $script:TranslationEnabled) { $script:Translation.State = "off"; $script:Translation.Detail = "switched off (-NoTranslation)" }

function Test-PortListening([int]$port) {
  $found = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
    Where-Object { $_.Port -eq $port }
  return [bool]$found
}

function Test-Healthy([string]$url) {
  try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; return ($r.StatusCode -eq 200) } catch { return $false }
}

function Stop-Tree($process) {
  if ($process -and -not $process.HasExited) {
    try { & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null } catch {}
  }
}

function Start-ReaderService {
  $s = $script:Reader
  $s.Healthy = $false; $s.EverHealthy = $false; $s.Fails = 0; $s.Task = $null; $s.Proc = $null; $s.Owned = $false
  if (Test-PortListening $AppPort) {
    if (Test-Healthy $s.Url) {
      $s.State = "running"; $s.Healthy = $true; $s.EverHealthy = $true
      $s.Detail = "was already running; left alone when you quit"
      Write-TrayLog "Reader: adopting the server already on port $AppPort"
    } else {
      $s.State = "error"; $s.Detail = "port $AppPort is in use by another program"
      Write-TrayLog "Reader: $($s.Detail)"
    }
    return
  }
  $env:READER_PORT = "$AppPort"
  if ($script:TranslationEnabled) { $env:READER_TRANSLATE_URL = "http://127.0.0.1:$LlamaPort" }
  $out = Join-Path $logDir "reader.out.log"
  $err = Join-Path $logDir "reader.err.log"
  $s.Proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm start" -WorkingDirectory $RepoDir -WindowStyle Hidden `
    -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $s.Proc.Handle
  $s.Owned = $true; $s.State = "starting"; $s.Detail = ""; $s.StartedAt = Get-Date
  Write-TrayLog "Reader: started (pid $($s.Proc.Id)) on port $AppPort"
}

function Start-TranslationService {
  $s = $script:Translation
  if (-not $script:TranslationEnabled) { return }
  $s.Healthy = $false; $s.EverHealthy = $false; $s.Fails = 0; $s.Task = $null; $s.Proc = $null; $s.Owned = $false
  $exe = Join-Path $RuntimeDir "llama-server.exe"
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    $s.State = "notsetup"; $s.Detail = "llama-server.exe not found in $RuntimeDir (see docs/translation-setup.md)"
    Write-TrayLog "Translation: $($s.Detail)"; return
  }
  if (-not (Test-Path -LiteralPath $ModelPath -PathType Leaf) -or (Get-Item -LiteralPath $ModelPath).Length -lt 1MB) {
    $s.State = "notsetup"; $s.Detail = "model file not found or incomplete: $ModelPath (see docs/translation-setup.md)"
    Write-TrayLog "Translation: $($s.Detail)"; return
  }
  if (Test-PortListening $LlamaPort) {
    if (Test-Healthy $s.Url) {
      $s.State = "running"; $s.Healthy = $true; $s.EverHealthy = $true
      $s.Detail = "was already running; left alone when you quit"
      Write-TrayLog "Translation: adopting the model server already on port $LlamaPort"
    } else {
      $s.State = "error"; $s.Detail = "port $LlamaPort is in use by another program"
      Write-TrayLog "Translation: $($s.Detail)"
    }
    return
  }
  $arguments = "-m `"$ModelPath`" -ngl $GpuLayers -c $ContextSize -np 1 --host 127.0.0.1 --port $LlamaPort --jinja"
  $out = Join-Path $logDir "translation.out.log"
  $err = Join-Path $logDir "translation.err.log"   # llama-server writes its log to stderr
  $s.Proc = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $RuntimeDir -WindowStyle Hidden `
    -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $s.Proc.Handle
  $s.Owned = $true; $s.State = "starting"; $s.Detail = ""; $s.StartedAt = Get-Date
  Write-TrayLog "Translation: started (pid $($s.Proc.Id)) on port $LlamaPort"
}

function Stop-Service2($s) {
  if ($s.Owned) { Stop-Tree $s.Proc }
  $s.Proc = $null; $s.Owned = $false; $s.Task = $null; $s.Healthy = $false
}

# One step of watching: collect the answer of the last health request, send the next, decide the state.
function Update-Service($s) {
  if ($s.State -eq "off" -or $s.State -eq "notsetup") { return }
  if ($s.State -eq "error" -and $s.Detail -like "port * in use*") { return }

  if ($s.Task -ne $null -and $s.Task.IsCompleted) {
    $ok = $false
    try {
      if (-not $s.Task.IsFaulted -and -not $s.Task.IsCanceled) {
        $ok = $s.Task.Result.IsSuccessStatusCode
        $s.Task.Result.Dispose()
      }
    } catch { $ok = $false }
    $s.Task = $null
    $s.Healthy = $ok
    if ($ok) { $s.Fails = 0; $s.EverHealthy = $true } else { $s.Fails++ }
  }
  if ($s.Task -eq $null) {
    try { $s.Task = $script:Http.GetAsync($s.Url) } catch { $s.Task = $null }
  }

  if ($s.Owned -and $s.Proc -ne $null -and $s.Proc.HasExited) {
    $s.State = "stopped"; $s.Detail = "exited with code $($s.Proc.ExitCode) (see the logs)"; $s.Healthy = $false
  } elseif ($s.Healthy) {
    $s.State = "running"; $s.Detail = $(if ($s.Owned) { "" } else { "was already running; left alone when you quit" })
  } elseif (-not $s.EverHealthy) {
    $waited = ((Get-Date) - $s.StartedAt).TotalSeconds
    if ($s.Owned -and $waited -ge $s.GraceSec) { $s.State = "error"; $s.Detail = "no answer after $([int]$waited) s (see the logs)" }
    else { $s.State = "starting" }
  } elseif ($s.Fails -ge 3) {
    $s.State = "error"; $s.Detail = "stopped answering (see the logs)"
  }
}

function Get-Word([string]$state) {
  switch ($state) {
    "running"  { return "running" }
    "starting" { return "starting" }
    "stopped"  { return "stopped" }
    "error"    { return "not answering" }
    "notsetup" { return "not set up" }
    default    { return "off" }
  }
}

# ---- tray ---------------------------------------------------------------------------------------------------------
$script:IconCache = @{}
$script:IconHandles = @()
function Get-StatusIcon([string]$left, [string]$right) {
  $key = "$left/$right"
  if (-not $script:IconCache.ContainsKey($key)) {
    $bitmap = New-StatusBitmap $left $right 32
    $handle = $bitmap.GetHicon()
    $script:IconHandles += $handle
    $script:IconCache[$key] = [System.Drawing.Icon]::FromHandle($handle)
    $bitmap.Dispose()
  }
  return $script:IconCache[$key]
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemOpen = New-Object System.Windows.Forms.ToolStripMenuItem "Open Verso"
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)
$itemReader = New-Object System.Windows.Forms.ToolStripMenuItem "Verso"
$itemReader.Enabled = $false
$itemTranslation = New-Object System.Windows.Forms.ToolStripMenuItem "Translation"
$itemTranslation.Enabled = $false
$itemRestartReader = New-Object System.Windows.Forms.ToolStripMenuItem "Restart Verso"
$itemRestartTranslation = New-Object System.Windows.Forms.ToolStripMenuItem "Restart Translation"
$itemLogs = New-Object System.Windows.Forms.ToolStripMenuItem "Open logs folder"
$itemQuit = New-Object System.Windows.Forms.ToolStripMenuItem "Quit (stop both)"
[void]$menu.Items.Add($itemOpen)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemReader)
[void]$menu.Items.Add($itemTranslation)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemRestartReader)
[void]$menu.Items.Add($itemRestartTranslation)
[void]$menu.Items.Add($itemLogs)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemQuit)
$notify.ContextMenuStrip = $menu

$context = New-Object System.Windows.Forms.ApplicationContext
$script:AnnouncedBoth = $false
$script:LastStatusJson = ""

function Format-Line($s) {
  $line = "$($s.Name): $(Get-Word $s.State)"
  if ($s.Detail) { $line += " - $($s.Detail)" }
  return $line
}

function Show-Balloon([string]$title, [string]$text, $icon) {
  try { $notify.ShowBalloonTip(5000, $title, $text, $icon) } catch {}
}

function Update-Tray {
  Update-Service $script:Reader
  Update-Service $script:Translation
  $r = $script:Reader; $t = $script:Translation

  $notify.Icon = Get-StatusIcon $r.State $t.State
  $tip = "Verso: $(Get-Word $r.State) | Translation: $(Get-Word $t.State)"
  $notify.Text = $(if ($tip.Length -gt 63) { $tip.Substring(0, 63) } else { $tip })
  $itemReader.Text = Format-Line $r
  $itemTranslation.Text = Format-Line $t

  $bothUp = ($r.State -eq "running") -and (($t.State -eq "running") -or -not $script:TranslationEnabled)
  if ($bothUp -and -not $script:AnnouncedBoth) {
    $script:AnnouncedBoth = $true
    $what = $(if ($script:TranslationEnabled) { "Verso and Translation are running." } else { "Verso is running." })
    Show-Balloon "Verso" "$what Double-click the icon to open it." ([System.Windows.Forms.ToolTipIcon]::Info)
  }
  foreach ($s in @($r, $t)) {
    if ($s.Prev -ne $s.State) {
      if (($s.State -eq "stopped" -or $s.State -eq "error") -and $s.Prev -ne "off") {
        Show-Balloon "Verso" (Format-Line $s) ([System.Windows.Forms.ToolTipIcon]::Warning)
        $script:AnnouncedBoth = $false
      }
      Write-TrayLog (Format-Line $s)
      $s.Prev = $s.State
    }
  }

  $status = [ordered]@{
    updated     = (Get-Date).ToString("o")
    reader      = [ordered]@{ state = $r.State; detail = $r.Detail; url = $readerUrl }
    translation = [ordered]@{ state = $t.State; detail = $t.Detail; url = "http://127.0.0.1:$LlamaPort" }
  } | ConvertTo-Json -Depth 4
  $comparable = ($status -replace '"updated":\s*"[^"]*",?', "")
  if ($comparable -ne $script:LastStatusJson) {
    $script:LastStatusJson = $comparable
    try { [System.IO.File]::WriteAllText((Join-Path $stateDir "status.json"), $status) } catch {}
  }
}

function Stop-Everything {
  $timer.Stop()
  Stop-Service2 $script:Reader
  Stop-Service2 $script:Translation
  Write-TrayLog "quit"
  $notify.Visible = $false
  $notify.Dispose()
  $context.ExitThread()
}

$notify.Add_DoubleClick({ Start-Process $readerUrl })
$itemOpen.Add_Click({ Start-Process $readerUrl })
$itemLogs.Add_Click({ Start-Process explorer.exe $logDir })
$itemQuit.Add_Click({ Stop-Everything })
$itemRestartReader.Add_Click({
  Stop-Service2 $script:Reader
  Start-Sleep -Milliseconds 800
  Start-ReaderService
})
$itemRestartTranslation.Add_Click({
  Stop-Service2 $script:Translation
  Start-Sleep -Milliseconds 800
  Start-TranslationService
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({
  try {
    if ($quitEvent.WaitOne(0)) { Stop-Everything; return }
    Update-Tray
  } catch { Write-TrayLog "tick failed: $($_.Exception.Message)" }
})

# ---- go -----------------------------------------------------------------------------------------------------------
try {
  Start-TranslationService   # first: it is the slow one
  Start-ReaderService
  Update-Tray
  $timer.Start()
  [System.Windows.Forms.Application]::Run($context)
} finally {
  # Also reached if something above throws: never leave servers running without their icon.
  try { Stop-Service2 $script:Reader; Stop-Service2 $script:Translation } catch {}
  try { $notify.Visible = $false; $notify.Dispose() } catch {}
  foreach ($handle in $script:IconHandles) { [void][ReaderTray.Native]::DestroyIcon($handle) }
  try { $quitEvent.Dispose() } catch {}
  try { $mutex.ReleaseMutex(); $mutex.Dispose() } catch {}
}
