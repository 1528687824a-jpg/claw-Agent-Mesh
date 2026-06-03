# Desktop Installer Notes

This page tracks the first real Tauri packaging proof for the thin desktop
client under `apps/desktop-app`.

## Verified Windows Build On 2026-06-01

The Windows packaging path is now verified on the local author machine.

Host/tooling state:

```text
Visual Studio Build Tools 2022: 17.14.37314.3
Install path: D:\BuildTools\VS2022\BuildTools
MSVC tools: D:\BuildTools\VS2022\BuildTools\VC\Tools\MSVC\14.44.35207
Windows SDK: C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0
cargo: 1.96.0
rustc: 1.96.0
WebView2: 148.0.3967.96
Rust target: stable-x86_64-pc-windows-msvc
```

Validation:

```powershell
npm --prefix apps/desktop-app exec tauri -- info
npm run smoke:tauri-shell
npm --prefix apps/desktop-app run tauri:build
```

`smoke:tauri-shell` result after installing Build Tools:

```text
rustToolchain=available
nativePackagingToolchain=available
nativePackagingDetails.source=vswhere
nativePackagingDetails.msvc=true
nativePackagingDetails.windowsSdk=true
buildRunnable=true
packagingRunnable=true
```

Installer artifacts from the successful full build:

```text
apps/desktop-app/src-tauri/target/release/bundle/msi/Agent OpenClaw_0.1.0_x64_en-US.msi
  size: 2.68 MB

apps/desktop-app/src-tauri/target/release/bundle/nsis/Agent OpenClaw_0.1.0_x64-setup.exe
  size: 1.78 MB
```

These generated artifacts are local build outputs and are not committed. Because
the repository currently lives on C:, the generated `src-tauri/target` cache was
deleted after verification to avoid leaving 1.3 GB of rebuildable cache on C:.
Copies of the verified installers were retained on D::

```text
D:\AgentOpenClaw\installers\2026-06-01\Agent OpenClaw_0.1.0_x64_en-US.msi
D:\AgentOpenClaw\installers\2026-06-01\Agent OpenClaw_0.1.0_x64-setup.exe
```

## What Changed For Packaging

Visual Studio Build Tools were installed on D: with the C++ workload:

```text
D:\BuildTools\VS2022\BuildTools
```

The first successful installation used the minimal bootstrapper form:

```powershell
D:\Installers\vs_BuildTools.exe `
  --quiet `
  --wait `
  --norestart `
  --installPath D:\BuildTools\VS2022\BuildTools `
  --add Microsoft.VisualStudio.Workload.VCTools `
  --includeRecommended
```

Earlier attempts that combined `--path install/cache/shared` and `--log`
returned exit code `87` on this host, so keep the minimal command above unless a
future build machine needs full cache relocation.

Tauri config changes:

```text
bundle.icon now points at src-tauri/icons/icon.ico and icon.png.
bundle.useLocalToolsDir=true keeps WiX/NSIS tools under src-tauri/target/.tauri.
```

`useLocalToolsDir=true` matters on Windows because the first MSI/NSIS attempts
timed out while downloading bundler tools into the user cache. The local tools
cache path made the NSIS and WiX downloads complete and keeps those generated
tools out of user AppData.

## Prior Blockers Resolved

The initial build proof found these issues in order:

```text
1. MSVC + Windows SDK missing.
   Fixed by installing Visual Studio Build Tools on D:.

2. src-tauri/icons/icon.ico missing.
   Fixed by adding a minimal app icon.

3. NSIS/WiX bundler downloads timed out in the default cache path.
   Fixed by setting bundle.useLocalToolsDir=true.

4. MSI bundler could not infer the icon.
   Fixed by adding bundle.icon to tauri.conf.json.
```

## Caveats

The Tauri desktop shell is now an optional wrapper around the web panel, not the
primary product path. It does not embed Postgres, the API, or the DBOS worker.
Start the local backend first when testing live jobs:

```powershell
docker compose up --build
```

Unsigned local Windows installer builds can trigger SmartScreen warnings. Code
signing is a release hardening task, not required for the first local packaging
proof.

## Other Platforms

This proof was performed on Windows. For open-source contributors on other
platforms, use the current Tauri prerequisite docs for exact package names:

```text
https://v2.tauri.app/start/prerequisites/
```

macOS desktop builds need Xcode or the Xcode Command Line Tools:

```bash
xcode-select --install
```

Linux package names vary by distribution. The official Debian/Ubuntu command is
currently:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

The shell smoke now gives actionable native packaging details on Windows,
macOS, and Linux:

```text
Windows:
  vswhere + MSVC tools + Windows SDK rc.exe

macOS:
  xcode-select -p

Linux:
  pkg-config probes for:
    webkit2gtk-4.1
    gtk+-3.0
    ayatana-appindicator3-0.1
    librsvg-2.0
    openssl
```

The Linux probe is a readiness signal, not a replacement for the official
distribution-specific Tauri prerequisite guide.
