param(
  [string]$InstallPath = "",
  [string]$RepoUrl = "https://github.com/amave423/Orqen-Studio.git",
  [switch]$Yes,
  [switch]$SkipSystemPackages,
  [switch]$SkipOllama,
  [switch]$WithOllama,
  [string]$Models = "",
  [string]$Model = "",
  [string]$AgentModels = "",
  [string]$RunnerMode = "",
  [string]$Proxy = "",
  [switch]$ExternalAccess,
  [string]$AuthToken = "",
  [int]$Port = 3000,
  [string]$OpenRouterApiKey = "",
  [string]$OpenAIApiKey = "",
  [string]$CustomApiKey = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message"
}

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-PathIfExists($Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  if ((Test-Path $Path) -and (($env:Path -split ";") -notcontains $Path)) {
    $env:Path = "$Path;$env:Path"
  }
}

function Refresh-KnownToolPaths {
  Add-PathIfExists (Join-Path ${env:ProgramFiles} "Git\cmd")
  Add-PathIfExists (Join-Path ${env:ProgramFiles(x86)} "Git\cmd")
  Add-PathIfExists (Join-Path $env:LOCALAPPDATA "Programs\Python\Launcher")
  Add-PathIfExists (Join-Path $env:LOCALAPPDATA "Programs\Ollama")
  Add-PathIfExists (Join-Path ${env:ProgramFiles} "Ollama")
}

Refresh-KnownToolPaths

function Test-Node22 {
  if (!(Test-Command "node")) { return $false }
  $version = (& node -p "process.versions.node").Trim()
  $parts = $version.Split(".")
  return ([int]$parts[0] -eq 22 -and [int]$parts[1] -ge 12)
}

function Test-Python312 {
  if (Test-Command "py") {
    & py -3.12 --version *> $null
    if ($LASTEXITCODE -eq 0) { return $true }
  }
  if (Test-Command "python") {
    $version = (& python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null)
    if ($version -eq "3.12") { return $true }
  }
  return $false
}

function Install-WingetPackage($Id, $Label) {
  if (!(Test-Command "winget")) {
    throw "winget was not found. Install App Installer from Microsoft Store or install $Label manually."
  }
  Write-Step "Installing $Label"
  winget install -e --id $Id --accept-package-agreements --accept-source-agreements
  Refresh-KnownToolPaths
}

function Install-PortableNode22 {
  if (Test-Node22) {
    Write-Step "Node.js $(node --version) is already available"
    return
  }

  $nodeVersion = "22.23.1"
  $toolsDir = Join-Path $PSScriptRoot ".tools"
  $nodeDir = Join-Path $toolsDir "node-v22"
  $nodeExe = Join-Path $nodeDir "node.exe"
  if (!(Test-Path $nodeExe)) {
    Write-Step "Installing portable Node.js $nodeVersion"
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $zipPath = Join-Path $toolsDir "node-v$nodeVersion-win-x64.zip"
    $url = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"
    Invoke-WebRequest -Uri $url -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
    $extracted = Join-Path $toolsDir "node-v$nodeVersion-win-x64"
    if (Test-Path $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
    Move-Item -LiteralPath $extracted -Destination $nodeDir
    Remove-Item -LiteralPath $zipPath -Force
  }

  $env:Path = "$nodeDir;$env:Path"
  Write-Host "Using portable Node.js $(& node --version)"
}

if ([string]::IsNullOrWhiteSpace($InstallPath)) {
  if ((Test-Path (Join-Path $PSScriptRoot "package.json")) -and (Test-Path (Join-Path $PSScriptRoot "installer"))) {
    $InstallPath = $PSScriptRoot
  } else {
    $InstallPath = Join-Path $HOME "Orqen Studio"
  }
}

if (!$SkipSystemPackages) {
  if (!(Test-Command "git")) {
    Install-WingetPackage "Git.Git" "Git"
  }

  if (!(Test-Python312)) {
    Install-WingetPackage "Python.Python.3.12" "Python 3.12"
  } else {
    Write-Step "Python 3.12 is already available"
  }

  Install-PortableNode22

  if ($WithOllama -and !$SkipOllama -and !(Test-Command "ollama")) {
    Install-WingetPackage "Ollama.Ollama" "Ollama"
  } elseif ($WithOllama -and !$SkipOllama) {
    Write-Step "Ollama is already available"
  } else {
    Write-Step "Skipping Ollama bootstrap. Local models can be installed later in the web UI."
  }
} else {
  Write-Step "Skipping system package installation"
  Install-PortableNode22
}

if (!(Test-Path (Join-Path $InstallPath "package.json"))) {
  if (Test-Path $InstallPath) {
    $entries = Get-ChildItem -Force -LiteralPath $InstallPath
    if ($entries.Count -gt 0) {
      throw "Install path exists but is not empty. Choose an empty folder or an existing Orqen Studio repo: $InstallPath"
    }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallPath) | Out-Null
  }

  Write-Step "Cloning Orqen Studio"
  git clone --depth 1 $RepoUrl $InstallPath
}

Set-Location $InstallPath
Refresh-KnownToolPaths

$argsList = @("--install-path", $InstallPath, "--repo-url", $RepoUrl)
if ($Yes) { $argsList += "--yes" }
if ($SkipOllama -or (!$WithOllama -and !(Test-Command "ollama"))) { $argsList += "--no-model-pull" }
if ($Models) { $argsList += @("--models", $Models) }
if ($Model) { $argsList += @("--model", $Model) }
if ($AgentModels) { $argsList += @("--agent-models", $AgentModels) }
if ($RunnerMode) { $argsList += @("--runner-mode", $RunnerMode) }
if ($Proxy) { $argsList += @("--proxy", $Proxy) }
if ($ExternalAccess) { $argsList += "--external-access" }
if ($AuthToken) { $argsList += @("--auth-token", $AuthToken) }
if ($Port -and $Port -ne 3000) { $argsList += @("--port", "$Port") }
if ($OpenRouterApiKey) { $argsList += @("--openrouter-api-key", $OpenRouterApiKey) }
if ($OpenAIApiKey) { $argsList += @("--openai-api-key", $OpenAIApiKey) }
if ($CustomApiKey) { $argsList += @("--custom-api-key", $CustomApiKey) }

Write-Step "Starting Orqen Studio installer"
node installer/cli.js @argsList
