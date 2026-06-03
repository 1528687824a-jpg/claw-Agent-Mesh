# Owner Tryout

This is the pre-release path for trying Agent OpenClaw on your own machine
before publishing a GitHub release. The primary path now opens a browser-based
web panel first. Opening the panel must not implicitly start Docker Desktop or
Docker Compose; backend startup is a separate, explicit action.

Use this when the question is not "can CI pass?" but "can I sit down and use
the product?"

## Start

From the repo root:

```powershell
npm run tryout:web
```

`npm run tryout:start` is the same web-panel alias.

This starts:

```text
Web panel     http://127.0.0.1:5173
API target    http://localhost:3000
```

If port `5173` is busy, the script chooses the next free port and prints the
actual URL. It also opens the panel automatically. If the API is offline, the
panel still opens and shows API offline.

To run live jobs, start the backend stack separately:

```powershell
docker compose up --build
```

That backend starts:

```text
Postgres + orchestrator-api + dbos-worker  http://localhost:3000
```

The web panel opens to First Run by default. That flow orients the owner,
collects provider settings, asks work-profile questions, and generates a safe
setup bundle for later agent personalization. It does not write the raw provider
key to disk.

Legacy full-stack tryout:

```powershell
npm run tryout:stack
```

This older path starts Docker Compose and the web panel together. It is useful
for engineering checks, not as the first user-facing experience.

## Language

The web panel currently supports:

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

In the web panel:

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
volumes so you can inspect prior jobs on the next run. When the current run was
web-panel only, it stops only the web panel and does not touch Docker Compose.

To delete local state too:

```powershell
docker compose down -v
```

## Logs And State

```text
logs/web-panel.log
.runtime/owner-tryout.json
```

If the web panel does not open, copy the printed `Web panel` URL into a browser.
If the API is offline, start the backend separately when you need live jobs.

## Release Boundary

This owner tryout should pass before cutting `v0.1.0-alpha`. Publishing to
GitHub is a later step; first make sure the local product experience is
comfortable enough to stand behind.
