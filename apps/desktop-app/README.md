# Agent OpenClaw Desktop Shell

This is the first Tauri delivery shell for the shared Web UI path.

The v1 desktop app is a thin client. It expects the backend stack to be running
locally through Docker Compose or the development scripts, then talks to
`http://localhost:3000`.

Current MVP surface:

```text
job list
status filters and prompt search over GET /jobs
new HTTP job creation
job detail summary
timeline view from GET /jobs/:id/timeline
cancel action through POST /jobs/:id/cancel
```

```powershell
docker compose up --build
npm install --prefix apps/desktop-app
npm --prefix apps/desktop-app run tauri:dev
```

The current repository smoke validates the shell structure and records whether
the Rust/Tauri build toolchain is installed. Full Tauri builds require Rust
(`cargo` and `rustc`) on the host.
