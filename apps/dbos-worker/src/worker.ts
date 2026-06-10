import "dotenv/config";
import { launchDbos } from "../../orchestrator-api/src/dbos-runtime";
import { startScheduleRunner } from "./scheduler";

function schedulerEnabled() {
  return process.env.HONEYCOMB_SCHEDULER_ENABLED !== "false";
}

function schedulerIntervalMs() {
  const value = Number(process.env.HONEYCOMB_SCHEDULER_POLL_MS ?? 60_000);
  return Number.isFinite(value) ? value : 60_000;
}

function schedulerBatchSize() {
  const value = Number(process.env.HONEYCOMB_SCHEDULER_BATCH_SIZE ?? 10);
  return Number.isFinite(value) ? value : 10;
}

async function main() {
  await launchDbos();
  console.log("DBOS worker launched for workflow recovery");

  if (schedulerEnabled()) {
    startScheduleRunner({
      intervalMs: schedulerIntervalMs(),
      limit: schedulerBatchSize(),
      runImmediately: true
    });
    console.log("Honeycomb scheduler runner enabled");
  } else {
    console.log("Honeycomb scheduler runner disabled");
  }

  await new Promise(() => {
    // Keep this optional worker process alive for recovery and scheduled tasks.
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
