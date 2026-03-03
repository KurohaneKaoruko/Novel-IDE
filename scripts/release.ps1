param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [switch]$AllowDirty,
    [switch]$SkipChecks,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command
    )
    Write-Host ">> $Command" -ForegroundColor Cyan
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $Command"
    }
}

function Resolve-PackageManager {
    if (Test-Path "pnpm-lock.yaml") {
        $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
        if (-not $pnpm) {
            throw "pnpm-lock.yaml detected, but 'pnpm' is not installed. Install pnpm (or enable corepack) and retry."
        }
        return "pnpm"
    }
    return "npm"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot

try {
    if ($Version -notmatch '^\d+\.\d+\.\d+([\-+][0-9A-Za-z\.-]+)?$') {
        throw "Invalid version '$Version'. Example: 0.2.0 or 0.2.0-beta.1"
    }

    $tag = "v$Version"
    $packageManager = Resolve-PackageManager

    if (-not $AllowDirty) {
        $dirty = git status --porcelain
        if ($LASTEXITCODE -ne 0) {
            throw "git status failed"
        }
        if ($dirty) {
            throw "Working tree is not clean. Commit/stash changes first, or use -AllowDirty."
        }
    }

    $existingTag = git tag --list $tag
    if ($LASTEXITCODE -ne 0) {
        throw "git tag failed"
    }
    if ($existingTag) {
        throw "Tag '$tag' already exists."
    }

    Write-Host "Updating versions to $Version ..." -ForegroundColor Yellow

    $env:RELEASE_VERSION = $Version
    @'
const fs = require("node:fs");
const path = require("node:path");
const version = process.env.RELEASE_VERSION;
if (!version) throw new Error("RELEASE_VERSION is empty");

const packagePath = path.resolve("package.json");
const tauriConfPath = path.resolve("src-tauri/tauri.conf.json");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = version;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
'@ | node
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to update package.json / tauri.conf.json"
    }
    Remove-Item Env:RELEASE_VERSION -ErrorAction SilentlyContinue

    $cargoPath = "src-tauri/Cargo.toml"
    $cargoRaw = Get-Content $cargoPath -Raw
    $cargoUpdated = [regex]::Replace(
        $cargoRaw,
        '(?m)^version\s*=\s*"[^\"]+"',
        ('version = "{0}"' -f $Version),
        1
    )
    if ($cargoUpdated -eq $cargoRaw) {
        throw "Failed to update version in $cargoPath"
    }
    Set-Content -Path $cargoPath -Value $cargoUpdated -Encoding utf8

    if (-not $SkipChecks) {
        Invoke-Step "$packageManager run build"
        Invoke-Step "cargo check --manifest-path src-tauri/Cargo.toml --target-dir .cargo-target"
    }

    Invoke-Step "git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json"

    $staged = git diff --cached --name-only
    if ($LASTEXITCODE -ne 0) {
        throw "git diff --cached failed"
    }
    if (-not $staged) {
        throw "No staged version changes detected."
    }

    Invoke-Step "git commit -m `"chore(release): $tag`""
    Invoke-Step "git tag $tag"

    if (-not $NoPush) {
        Invoke-Step "git push origin HEAD"
        Invoke-Step "git push origin $tag"
        Write-Host ""
        Write-Host "Release tag pushed: $tag" -ForegroundColor Green
        Write-Host "GitHub Actions workflow will build bundles and publish the release." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "Tag created locally: $tag (not pushed due to -NoPush)." -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}
