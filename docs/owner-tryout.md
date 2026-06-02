# Owner Tryout

This is the pre-release path for trying Agent OpenClaw on your own machine
before publishing a GitHub release. It starts the HTTP-only mock backend and the
desktop web console together, then opens the console in your browser.

Use this when the question is not "can CI pass?" but "can I sit down and use
the product?"

## Start

From the repo root:

```powershell
npm run tryout:start
```

The script starts:

```text
Postgres + orchestrator-api + dbos-worker  http://localhost:3000
Desktop web console                       http://127.0.0.1:5173
```

If port `5173` is busy, the script chooses the next free port and prints the
actual URL. It also opens the desktop console automatically.

## What To Try

In the desktop console:

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
