# Agent OpenClaw Web Panel

This is the browser-based control panel for Agent OpenClaw.

The panel can open without Docker Desktop. It talks to `http://localhost:3000`
when an orchestrator API is already running, and otherwise shows API offline. It
has two top-level views:

```text
First Run   orient the owner, configure a provider key, answer a work interview,
            and generate a safe desktop setup bundle
Console     create, inspect, filter, and cancel orchestrator jobs
```

First Run keeps the provider key in memory for the current session. The
generated setup files record only that a key was configured; they do not write
the secret to disk.

Current console surface:

```text
job list
status filters and prompt search over GET /jobs
new HTTP job creation
job detail summary
timeline view from GET /jobs/:id/timeline
cancel action through POST /jobs/:id/cancel
```

From the repo root, the product-like owner path is:

```powershell
npm run tryout:web
```

That opens the web panel only. It does not start Docker Desktop or Docker
Compose.

Manual development path:

```powershell
npm install --prefix apps/desktop-app
npm --prefix apps/desktop-app run dev
```

Start `docker compose up --build` in a separate terminal only when you want live
jobs. The First Run save command currently stores the preview in browser state:

```text
first-run-profile.json
cluster.config.json
agents/<agent-id>/AGENTS.md
```

The old Tauri shell can still wrap this panel later, but it is no longer the
primary product path. Full Tauri packaging requires Rust (`cargo` and `rustc`)
plus the host native packaging toolchain. On Windows that means Visual Studio
Build Tools with MSVC and a Windows SDK.

Installer build notes and the verified Windows artifact paths are tracked in
`docs/desktop-installer-notes.md`.
