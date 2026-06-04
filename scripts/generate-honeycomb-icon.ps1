param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) {
  $OutputPath = Join-Path $root "apps\desktop-app\src-tauri\icons\icon.png"
}

$size = 1024
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$scale = $size * 0.82 / 100.0
$offset = $size * 0.09
$gold = [System.Drawing.ColorTranslator]::FromHtml("#F5B942")
$white = [System.Drawing.ColorTranslator]::FromHtml("#F7F1DF")
$pen = [System.Drawing.Pen]::new($gold, 8 * $scale)
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
$brush = [System.Drawing.SolidBrush]::new($white)

function Points([double[][]]$Coordinates) {
  return [System.Drawing.PointF[]]@(
    $Coordinates | ForEach-Object {
      [System.Drawing.PointF]::new([single](($_[0] * $scale) + $offset), [single](($_[1] * $scale) + $offset))
    }
  )
}

$graphics.DrawLines($pen, (Points @(@(50, 5), @(76, 20), @(76, 46), @(67, 51))))
$graphics.DrawLines($pen, (Points @(@(33, 51), @(24, 46), @(24, 20), @(50, 5))))
$graphics.DrawLines($pen, (Points @(@(45, 58), @(44, 86), @(22, 98), @(3, 87), @(3, 63), @(24, 51), @(36, 58))))
$graphics.DrawLines($pen, (Points @(@(55, 58), @(56, 86), @(78, 98), @(97, 87), @(97, 63), @(76, 51), @(64, 58))))
$graphics.FillPolygon($brush, (Points @(@(50, 36), @(65, 45), @(65, 63), @(50, 72), @(35, 63), @(35, 45))))

$directory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$brush.Dispose()
$pen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "Generated honeycomb icon: $OutputPath"
