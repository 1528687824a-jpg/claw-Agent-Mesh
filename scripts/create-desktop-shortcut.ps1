param(
  [string]$ShortcutName = "Agent OpenClaw"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "$ShortcutName.lnk"
$launcherScript = Join-Path $root "scripts\launch-desktop-app.vbs"
$iconPath = Join-Path $root "apps\desktop-app\src-tauri\icons\icon.ico"

if (-not (Test-Path -LiteralPath $launcherScript)) {
  throw "Launcher script not found: $launcherScript"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$launcherScript`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Launch Agent OpenClaw desktop app"
if (Test-Path -LiteralPath $iconPath) {
  $shortcut.IconLocation = $iconPath
}
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output "Created desktop shortcut: $shortcutPath"
