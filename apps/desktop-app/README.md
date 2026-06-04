# honeycomb Desktop Shell

This is the Tauri desktop control surface for honeycomb.

The v1 desktop app expects the backend stack to be running locally through
Docker Compose or the development scripts, then talks to `http://localhost:3000`.
It now has two top-level views:

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
npm run tryout:desktop
```

That starts the local backend stack and opens the Tauri desktop app.

Manual development path:

```powershell
docker compose up --build
npm install --prefix apps/desktop-app
npm --prefix apps/desktop-app run tauri:dev
```

The First Run save command writes the preview bundle under the app data
directory in `desktop-first-run`:

```text
first-run-profile.json
cluster.config.json
agents/<agent-id>/AGENTS.md
```

The current repository smoke validates the shell structure and records whether
the Rust/Tauri build toolchain is installed. Full Tauri packaging requires Rust
(`cargo` and `rustc`) plus the host native packaging toolchain. On Windows that
means Visual Studio Build Tools with MSVC and a Windows SDK.

Installer build notes and the verified Windows artifact paths are tracked in
`docs/desktop-installer-notes.md`.
