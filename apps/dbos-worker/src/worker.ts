import "dotenv/config";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { closePool } from "../../../packages/db/src/pool";
import { launchDbos } from "./dbos-runtime";
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

  let stopScheduler: (() => void) | null = null;
  if (schedulerEnabled()) {
    stopScheduler = startScheduleRunner({
      intervalMs: schedulerIntervalMs(),
      limit: schedulerBatchSize(),
      runImmediately: true
    });
    console.log("Honeycomb scheduler runner enabled");
  } else {
    console.log("Honeycomb scheduler runner disabled");
  }

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down DBOS worker`);

    const forceExitTimer = setTimeout(() => {
      console.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    stopScheduler?.();
    void DBOS.shutdown()
      .catch((error) => {
        console.error("DBOS shutdown failed", error);
      })
      .then(() => closePool())
      .catch((error) => {
        console.error("Failed to close database pool", error);
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise(() => {
    // Keep this optional worker process alive for recovery and scheduled tasks.
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
