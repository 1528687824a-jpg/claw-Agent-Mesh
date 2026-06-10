import {
  appendJobEvent,
  createJob
} from "../../../packages/db/src/jobs";
import {
  claimDueScheduledTasks,
  computeNextScheduledRunAt,
  markScheduledTaskTriggered,
  patchScheduledTask
} from "../../../packages/db/src/schedules";
import type { ScheduledTaskRecord } from "../../../packages/shared/src/types";
import { startJobWorkflow } from "../../orchestrator-api/src/dbos-runtime";

type SchedulerResult = {
  scheduleId: string;
  jobId: string | null;
  workflowId: string | null;
  status: "queued" | "idle" | "failed";
  error: string | null;
};

export type SchedulerRunSummary = {
  checkedAt: string;
  claimed: number;
  results: SchedulerResult[];
};

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/\u0000/g, "");
}

function nextRunAfterFailure(schedule: ScheduledTaskRecord, now: Date) {
  return computeNextScheduledRunAt(
    {
      scheduleType: schedule.scheduleType,
      enabled: schedule.enabled,
      runAt: schedule.runAt,
      intervalSeconds: schedule.intervalSeconds
    },
    now
  );
}

export async function runDueSchedulesOnce(input: {
  now?: Date;
  limit?: number;
  startWorkflow?: boolean;
  requesterIdPrefix?: string;
} = {}): Promise<SchedulerRunSummary> {
  const checkedAtDate = input.now ?? new Date();
  const checkedAt = checkedAtDate.toISOString();
  const startWorkflow = input.startWorkflow ?? true;
  const requesterIdPrefix = input.requesterIdPrefix ?? "schedule";
  const schedules = await claimDueScheduledTasks(checkedAtDate, input.limit ?? 10);
  const results: SchedulerResult[] = [];

  for (const schedule of schedules) {
    let jobId: string | null = null;
    try {
      const job = await createJob({
        rawPrompt: schedule.prompt,
        workdir: schedule.workspacePath ?? undefined,
        ingressOrigin: "http",
        routingMode: schedule.routingMode,
        maxModelCalls: schedule.maxModelCalls,
        requesterId: `${requesterIdPrefix}:${schedule.id}`
      });
      jobId = job.id;
      await appendJobEvent(
        job.id,
        "schedule.triggered",
        {
          scheduleId: schedule.id,
          scheduleType: schedule.scheduleType,
          nextRunAt: schedule.nextRunAt,
          triggeredBy: "scheduler"
        },
        {
          actor: "scheduler"
        }
      );

      const workflowId = startWorkflow ? await startJobWorkflow(job.id) : null;
      await markScheduledTaskTriggered({
        scheduleId: schedule.id,
        jobId: job.id,
        triggeredAt: checkedAt,
        status: startWorkflow ? "queued" : "idle"
      });

      results.push({
        scheduleId: schedule.id,
        jobId: job.id,
        workflowId,
        status: startWorkflow ? "queued" : "idle",
        error: null
      });
    } catch (error) {
      const message = safeErrorMessage(error);
      if (jobId) {
        await markScheduledTaskTriggered({
          scheduleId: schedule.id,
          jobId,
          triggeredAt: checkedAt,
          status: "failed",
          error: message
        });
      } else {
        await patchScheduledTask(schedule.id, {
          status: "failed",
          lastError: message,
          nextRunAt: nextRunAfterFailure(schedule, checkedAtDate)
        });
      }

      results.push({
        scheduleId: schedule.id,
        jobId,
        workflowId: null,
        status: "failed",
        error: message
      });
    }
  }

  return {
    checkedAt,
    claimed: schedules.length,
    results
  };
}

export function startScheduleRunner(input: {
  intervalMs?: number;
  limit?: number;
  startWorkflow?: boolean;
  runImmediately?: boolean;
} = {}) {
  const intervalMs = Math.max(input.intervalMs ?? 60_000, 5_000);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      const summary = await runDueSchedulesOnce({
        limit,
        startWorkflow: input.startWorkflow ?? true
      });
      if (summary.claimed > 0) {
        console.log(`Honeycomb scheduler triggered ${summary.results.length} scheduled task(s)`);
      }
    } catch (error) {
      console.error("Honeycomb scheduler tick failed", error);
    } finally {
      running = false;
    }
  }

  if (input.runImmediately ?? true) {
    void tick();
  }
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
