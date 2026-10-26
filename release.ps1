# A release of the studio on GitHub, which the studio itself finds and offers to install (src/app/updates.ts):
#   .\release.ps1 -Version 0.2.0 -Notes "What's new"           build, sign and publish
#   .\release.ps1 -Version 0.2.0 -DryRun                       build and sign only (nothing published)
# The version goes into tauri.conf.json, package.json and the workspace's Cargo.toml; the installer is signed with the update key
# (%USERPROFILE%\.tauri\jibbers-map-studio.key, never in the repository: the studio only installs updates signed with
# it, so keep a copy of it somewhere safe); latest.json, the installer and its signature go up as release v<version>.
param(
    [Parameter(Mandatory)][string]$Version,
    [string]$Notes = "",
    [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$repo = "chrisrca/jibbers-map-studio"
$key = Join-Path $env:USERPROFILE ".tauri\jibbers-map-studio.key"
if (-not (Test-Path $key)) { throw "No update key at $key" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version like 1.2.3" }

# the version, everywhere it's kept (written as UTF-8 without a byte order mark)
$utf8 = New-Object System.Text.UTF8Encoding $false
function Set-Version($file, $pattern, $replacement) {
    $text = [IO.File]::ReadAllText($file)
    $new = [regex]::new($pattern, 'Multiline').Replace($text, $replacement, 1)
    if ($new -eq $text -and $text -notmatch [regex]::Escape($Version)) { throw "Version not found in $file" }
    [IO.File]::WriteAllText($file, $new, $utf8)
}
Set-Version (Join-Path $root "src-tauri\tauri.conf.json") '"version":\s*"[^"]*"' "`"version`": `"$Version`""
Set-Version (Join-Path $root "package.json") '"version":\s*"[^"]*"' "`"version`": `"$Version`""
Set-Version (Join-Path $root "src-tauri\Cargo.toml") '^version\s*=\s*"[^"]*"' "version = `"$Version`""

# built at low priority on half the cores (the machine stays usable), signed with the update key
(Get-Process -Id $PID).PriorityClass = "BelowNormal"
$env:CARGO_BUILD_JOBS = [Math]::Max(2, [int]($env:NUMBER_OF_PROCESSORS / 2))
$env:TAURI_SIGNING_PRIVATE_KEY = $key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
Push-Location $root
try {
    # (its progress comes on stderr: not an error, its exit code says)
    $ErrorActionPreference = "Continue"
    npx tauri build
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "build failed" }
} finally { Pop-Location }

$nsis = Join-Path $root "src-tauri\target\release\bundle\nsis"
$exe = Get-ChildItem $nsis -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
if (-not $exe) { throw "No installer for $Version in $nsis" }
$sig = Get-Content "$($exe.FullName).sig" -Raw
# (GitHub's file names: spaces become dots)
$asset = $exe.Name -replace ' ', '.'
$latest = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sig.Trim()
            url       = "https://github.com/$repo/releases/download/v$Version/$asset"
        }
    }
}
$latestFile = Join-Path $nsis "latest.json"
[IO.File]::WriteAllText($latestFile, ($latest | ConvertTo-Json -Depth 5), $utf8)
"Installer: $($exe.FullName)"
"Update manifest: $latestFile"

if ($DryRun) { "Dry run: nothing published"; return }
$upload = Join-Path $nsis $asset
if ($upload -ne $exe.FullName) { Copy-Item $exe.FullName $upload -Force; Copy-Item "$($exe.FullName).sig" "$upload.sig" -Force }
gh release create "v$Version" $upload "$upload.sig" $latestFile --repo $repo --title "Jibbers Map Studio $Version" --notes $(if ($Notes) { $Notes } else { "Jibbers Map Studio $Version" })
if ($LASTEXITCODE -ne 0) { throw "gh release failed" }
"Published v$Version"
