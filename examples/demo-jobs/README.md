# Demo Jobs

These are ready-to-post `POST /jobs` bodies for the four routing modes. Start
the quickstart stack first:

```powershell
docker compose up --build
```

## Bash / curl

```bash
cat examples/demo-jobs/supervisor-pipeline.json \
  | curl -s -X POST http://localhost:3000/jobs \
      -H 'content-type: application/json' \
      -d @-

cat examples/demo-jobs/pipeline.json \
  | curl -s -X POST http://localhost:3000/jobs \
      -H 'content-type: application/json' \
      -d @-

cat examples/demo-jobs/classic-master-slave.json \
  | curl -s -X POST http://localhost:3000/jobs \
      -H 'content-type: application/json' \
      -d @-

cat examples/demo-jobs/master-slave-discussion.json \
  | curl -s -X POST http://localhost:3000/jobs \
      -H 'content-type: application/json' \
      -d @-
```

## PowerShell

```powershell
$body = Get-Content -Raw examples/demo-jobs/supervisor-pipeline.json
Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body

$body = Get-Content -Raw examples/demo-jobs/pipeline.json
Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body

$body = Get-Content -Raw examples/demo-jobs/classic-master-slave.json
Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body

$body = Get-Content -Raw examples/demo-jobs/master-slave-discussion.json
Invoke-RestMethod -Uri 'http://localhost:3000/jobs' -Method Post -ContentType 'application/json' -Body $body
```

Each response returns a `jobId`. Poll it and inspect outputs:

```powershell
$jobId = '<JOB-ID>'
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId/messages"
Invoke-RestMethod -Uri "http://localhost:3000/jobs/$jobId/timeline"
```

## Which One To Try First

```text
supervisor-pipeline.json        safest default, per-stage review and retry
pipeline.json                   fast linear handoff
classic-master-slave.json       independent child outputs, final gate enabled
master-slave-discussion.json    two persisted discussion rounds, then synthesis
```
