# Owner Tryout

This is the pre-release path for trying Agent OpenClaw on your own machine
before publishing a GitHub release. The primary path starts the HTTP-only mock
backend and opens the Tauri desktop application, so the first thing you feel is
the desktop product rather than a browser dashboard.

Use this when the question is not "can CI pass?" but "can I sit down and use
the product?"

## Start

From the repo root:

```powershell
npm run tryout:desktop
```

To create a desktop launch icon first:

```powershell
npm run tryout:shortcut
```

That creates `Agent OpenClaw.lnk` on the Windows desktop. Double-clicking it
starts the local backend in the background and opens the Tauri desktop app. It
logs startup details to `logs/desktop-launcher.log` instead of leaving a
PowerShell build window in front of the product.

The script starts:

```text
Postgres + orchestrator-api + dbos-worker  http://localhost:3000
Tauri desktop app                          apps/desktop-app
```

The desktop app opens to First Run by default. That flow orients the owner,
collects provider settings, asks work-profile questions, and generates a safe
setup bundle for later agent personalization. It does not write the raw provider
key to disk.

Browser development fallback:

```powershell
npm run tryout:start
```

That fallback starts:

```text
Postgres + orchestrator-api + dbos-worker  http://localhost:3000
Desktop web console                       http://127.0.0.1:5173
```

If port `5173` is busy, the script chooses the next free port and prints the
actual URL. It also opens the desktop console automatically.

## Language

The desktop console currently supports:

```text
English
中文
```

Use the language switch in the top bar. For direct links:

```text
http://127.0.0.1:5173/?lang=en
http://127.0.0.1:5173/?lang=zh
```

## What To Try

In the desktop app:

```text
1. Confirm the app opens on First Run.
2. Switch English / 中文 from the top bar.
3. Review the guide panel.
4. Confirm DeepSeek and deepseek-v4-pro are prefilled.
5. Enter a provider key for the current session.
6. Adjust the work interview answers.
7. Confirm the generated profile, recommended routing mode, and agent prompts.
8. Save the setup bundle.
9. Switch to Console and confirm the API status reads online.
```

In step 7, "confirm" means reviewing the generated draft after the interview,
not approving anything blindly before seeing it. Check:

```text
1. whether the work profile describes your real role and daily work accurately;
2. whether the recommended routing mode fits how you expect the agent team to work;
3. whether each proposed agent has the right responsibility, boundary, and tone;
4. whether any agent prompt is too vague, too aggressive, or missing a tool/workflow;
5. whether the generated bundle is only a draft to review, or is ready for a later
   backup-and-write step into the real OpenClaw agent framework.
```

Then in Console:

```text
1. Confirm the API status reads online.
2. Create a job with routingMode=supervisor_pipeline.
3. Open the job and inspect messages.
4. Inspect the timeline.
5. Try the job search/filter controls.
6. Create another job with a different routing mode.
```

The tryout uses mock-mode agents. It does not call real LLM/provider services
and does not require Feishu credentials.

OpenClaw real mode validation across the four routing modes is a later ordered
engineering task. It is not part of the owner First Run flow.

## Stop

```powershell
npm run tryout:stop
```

This stops the desktop dev server and Docker containers, but keeps Docker
volumes so you can inspect prior jobs on the next run.

To delete local state too:

```powershell
docker compose down -v
```

## Logs And State

```text
logs/owner-tryout-desktop.log
.runtime/owner-tryout.json
```

If the desktop console does not open, copy the printed `Desktop UI` URL into a
browser. If the API is offline, stop the tryout and start it again after Docker
Desktop is fully running.

## Release Boundary

This owner tryout should pass before cutting `v0.1.0-alpha`. Publishing to
GitHub is a later step; first make sure the local product experience is
comfortable enough to stand behind.
