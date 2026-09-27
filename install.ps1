<#
.SYNOPSIS
  Installs or updates "Menu del dia" (La Sazon de Luis) on Windows. Safe to run again at any time.

.DESCRIPTION
  1. Installs Node.js LTS and Git if missing (winget).
  2. Clones the repo, or updates it (git pull) if it is already there.
  3. Installs Claude Code for the AI features if missing (skip with -NoAI). Missing AI is only a warning.
  4. Runs the app setup: packages, .env.local, database, seed data, production build.
  5. Creates a desktop shortcut (and a Startup shortcut with -Autostart), then starts the app.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Dir C:\menu -NoAI -Autostart
.EXAMPLE
  # From nothing (no clone yet):
  irm https://raw.githubusercontent.com/xvanov/menu-creator/main/install.ps1 | iex
#>
param(
  [string]$Dir = $(if ($env:MENU_DIR) { $env:MENU_DIR } else { Join-Path $env:USERPROFILE "menu-creator" }),
  [string]$Repo = $(if ($env:MENU_REPO) { $env:MENU_REPO } else { "https://github.com/xvanov/menu-creator.git" }),
  [switch]$NoAI,
  [switch]$Autostart,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
function Ok($m) { Write-Host "[ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user;$env:USERPROFILE\.local\bin"
}
function Winget-Install($id, $what) {
  if (-not (Has "winget")) { throw "$what is missing and winget is not available. Install $what manually and run this again." }
  Write-Host "Installing $what with winget..."
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  Refresh-Path
}

# 1. Prerequisites
Step "Prerequisites"
Refresh-Path
$nodeOk = $false
if (Has "node") {
  $v = (& node -p "process.versions.node").Trim()
  $p = $v.Split(".") | ForEach-Object { [int]$_ }
  $nodeOk = ($p[0] -gt 20) -or ($p[0] -eq 20 -and $p[1] -ge 12)
  if ($nodeOk) { Ok "Node $v" } else { Warn "Node $v is too old" }
}
if (-not $nodeOk) {
  Winget-Install "OpenJS.NodeJS.LTS" "Node.js LTS"
  if (-not (Has "node")) { throw "Node.js was installed but is not on PATH yet. Close this window and run the installer again." }
  Ok ("Node " + (& node -p "process.versions.node"))
}
if (Has "git") { Ok "Git" } else {
  Winget-Install "Git.Git" "Git"
  if (-not (Has "git")) { throw "Git was installed but is not on PATH yet. Close this window and run the installer again." }
  Ok "Git"
}

# 2. Code
Step "Code in $Dir"
if (Test-Path (Join-Path $Dir "package.json")) {
  if (Test-Path (Join-Path $Dir ".git")) {
    & git -C $Dir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Warn "git pull failed (local changes or no network). Continuing with the current code." } else { Ok "Updated" }
  } else { Ok "Using existing folder" }
} else {
  & git clone $Repo $Dir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed. If the repository is private, log in to GitHub (Git Credential Manager will ask) and run again." }
  Ok "Cloned"
}
Set-Location $Dir

# 3. AI (optional)
Step "AI (Claude Code)"
if ($NoAI) {
  Warn "Skipped (-NoAI). The app works without AI; set GEMINI_API_KEY or ANTHROPIC_API_KEY in .env.local to use an API instead."
} elseif (Has "claude") {
  Ok ("Claude Code " + (& claude --version))
} else {
  try {
    # separate process so the official installer can't end this script
    & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
    Refresh-Path
    if (Has "claude") { Ok "Claude Code installed. Run 'claude' once in a terminal to log in with your Claude account." }
    else { Warn "Claude Code installed but not on PATH yet; open a new terminal and run 'claude' once to log in." }
  } catch {
    Warn "Could not install Claude Code ($($_.Exception.Message)). AI features will show a warning and fall back to rules."
  }
}

# 4. App setup (idempotent)
Step "App setup"
& npm run setup
if ($LASTEXITCODE -ne 0) { throw "Setup failed (see the messages above)." }

# 5. Shortcuts
Step "Shortcuts"
$shell = New-Object -ComObject WScript.Shell
function Make-Shortcut($path) {
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = Join-Path $Dir "Iniciar.cmd"
  $s.WorkingDirectory = $Dir
  $s.WindowStyle = 7  # minimized
  $s.Description = "Menu del dia - La Sazon de Luis"
  $s.Save()
}
Make-Shortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Menu del dia.lnk")
Ok "Desktop shortcut 'Menu del dia'"
$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "Menu del dia.lnk"
if ($Autostart) { Make-Shortcut $startup; Ok "Starts automatically when you log in" }
elseif (Test-Path $startup) { Ok "Autostart already on (kept)" }

# 6. Start
if (-not $NoStart) {
  Step "Starting"
  $listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  if ($listening) { Ok "Already running on http://localhost:3000"; Start-Process "http://localhost:3000" }
  else { Start-Process -FilePath (Join-Path $Dir "Iniciar.cmd") -WorkingDirectory $Dir -WindowStyle Minimized; Ok "Opening http://localhost:3000" }
}
Write-Host "`nListo." -ForegroundColor Green
