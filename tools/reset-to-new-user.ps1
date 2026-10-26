# The studio as a new user has it: its data folder (%APPDATA%\Jibbers Studio: your asset library, the game's look,
# caches) and its window's storage (%LOCALAPPDATA%\fun.jibbers.mapstudio) go to the Recycle Bin. Your maps (Documents\
# Jibbers Maps) and the game are left alone. Close the studio first.
#
#   powershell -ExecutionPolicy Bypass -File tools\reset-to-new-user.ps1

$ErrorActionPreference = "Stop"
if (Get-Process -Name "jibbers-studio*" -ErrorAction SilentlyContinue) {
    Write-Host "The studio is open: close it first, then run this again."
    exit 1
}
Add-Type -AssemblyName Microsoft.VisualBasic
$folders = @((Join-Path $env:APPDATA "Jibbers Studio"), (Join-Path $env:LOCALAPPDATA "fun.jibbers.mapstudio"))
foreach ($f in $folders) {
    if (Test-Path $f) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($f, "OnlyErrorDialogs", "SendToRecycleBin")
        Write-Host "Moved to the Recycle Bin: $f"
    } else {
        Write-Host "Not there (already new): $f"
    }
}
Write-Host "Done: the studio starts as it would for a new user."
