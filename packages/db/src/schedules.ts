import { randomUUID } from "node:crypto";
import {
  DEFAULT_MAX_MODEL_CALLS,
  DEFAULT_ROUTING_MODE,
  ROUTING_MODES,
  SCHEDULE_TASK_STATUSES,
  SCHEDULE_TYPES,
  type RoutingMode,
  type ScheduledTaskRecord,
  type ScheduledTaskStatus,
  type ScheduleType
} from "../../shared/src/types";
import { pool } from "./pool";

type ScheduledTaskWritable = {
  id?: string;
  title: string;
  prompt: string;
  scheduleType?: ScheduleType;
  enabled?: boolean;
  workspacePath?: string | null;
  routingMode?: RoutingMode;
  maxModelCalls?: number;
  providerId?: string | null;
  agentId?: string | null;
  runAt?: string | null;
  intervalSeconds?: number | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  status?: ScheduledTaskStatus;
  lastJobId?: string | null;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
};

function fallbackId() {
  return `schedule-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeScheduleType(value: unknown): ScheduleType {
  return typeof value === "string" && (SCHEDULE_TYPES as readonly string[]).includes(value)
    ? (value as ScheduleType)
    : "manual";
}

function normalizeScheduledTaskStatus(value: unknown): ScheduledTaskStatus {
  return typeof value === "string" &&
    (SCHEDULE_TASK_STATUSES as readonly string[]).includes(value)
    ? (value as ScheduledTaskStatus)
    : "idle";
}

function normalizeRoutingMode(value: unknown): RoutingMode {
  return typeof value === "string" && (ROUTING_MODES as readonly string[]).includes(value)
    ? (value as RoutingMode)
    : DEFAULT_ROUTING_MODE;
}

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoOrNull(date: Date | null) {
  return date ? date.toISOString() : null;
}

function computeDailyNextRunAt(runAt: string | null | undefined, now: Date) {
  const base = parseDate(runAt) ?? now;
  const next = new Date(now);
  next.setUTCHours(
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds()
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export function computeNextScheduledRunAt(
  input: {
    scheduleType?: ScheduleType;
    enabled?: boolean;
    runAt?: string | null;
    intervalSeconds?: number | null;
  },
  now = new Date()
): string | null {
  if (input.enabled === false) {
    return null;
  }

  const scheduleType = input.scheduleType ?? "manual";
  if (scheduleType === "manual") {
    return null;
  }

  if (scheduleType === "once") {
    const onceAt = parseDate(input.runAt);
    return onceAt && onceAt.getTime() > now.getTime() ? onceAt.toISOString() : null;
  }

  if (scheduleType === "daily") {
    return computeDailyNextRunAt(input.runAt, now).toISOString();
  }

  const intervalSeconds = input.intervalSeconds ?? null;
  if (scheduleType === "interval" && intervalSeconds && intervalSeconds > 0) {
    return new Date(now.getTime() + intervalSeconds * 1000).toISOString();
  }

  return null;
}

function toScheduledTaskRecord(row: any): ScheduledTaskRecord {
  return {
    id: row.id,
    title: row.title,
    prompt: row.raw_prompt,
    scheduleType: normalizeScheduleType(row.schedule_type),
    enabled: row.enabled ?? true,
    workspacePath: row.workspace_path,
    routingMode: normalizeRoutingMode(row.routing_mode),
    maxModelCalls: Number(row.max_model_calls ?? DEFAULT_MAX_MODEL_CALLS),
    providerId: row.provider_id,
    agentId: row.agent_config_id,
    runAt: row.run_at ? row.run_at.toISOString() : null,
    intervalSeconds: row.interval_seconds === null ? null : Number(row.interval_seconds),
    nextRunAt: row.next_run_at ? row.next_run_at.toISOString() : null,
    lastRunAt: row.last_run_at ? row.last_run_at.toISOString() : null,
    status: normalizeScheduledTaskStatus(row.status),
    lastJobId: row.last_job_id,
    lastError: row.last_error,
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function listScheduledTasks(input: {
  status?: ScheduledTaskStatus;
  enabled?: boolean;
  limit?: number;
} = {}): Promise<{
  schedules: ScheduledTaskRecord[];
  filters: {
    status: ScheduledTaskStatus | null;
    enabled: boolean | null;
    limit: number;
  };
}> {
  const values: unknown[] = [];
  const where: string[] = [];
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  if (input.status) {
    values.push(input.status);
    where.push(`status = $${values.length}`);
  }
  if (input.enabled !== undefined) {
    values.push(input.enabled);
    where.push(`enabled = $${values.length}`);
  }
  values.push(limit);

  const result = await pool.query(
    `select *
     from agent.scheduled_tasks
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by enabled desc, next_run_at asc nulls last, updated_at desc, id asc
     limit $${values.length}`,
    values
  );

  return {
    schedules: result.rows.map(toScheduledTaskRecord),
    filters: {
      status: input.status ?? null,
      enabled: input.enabled ?? null,
      limit
    }
  };
}

export async function listDueScheduledTasks(
  now = new Date(),
  limit = 50
): Promise<ScheduledTaskRecord[]> {
  const result = await pool.query(
    `select *
     from agent.scheduled_tasks
     where enabled = true
       and next_run_at is not null
       and next_run_at <= $1::timestamptz
       and status <> 'running'
     order by next_run_at asc, id asc
     limit $2`,
    [now.toISOString(), Math.min(Math.max(limit, 1), 200)]
  );
  return result.rows.map(toScheduledTaskRecord);
}

export async function getScheduledTask(scheduleId: string): Promise<ScheduledTaskRecord | null> {
  const result = await pool.query(`select * from agent.scheduled_tasks where id = $1`, [
    scheduleId
  ]);
  return result.rows[0] ? toScheduledTaskRecord(result.rows[0]) : null;
}

export async function upsertScheduledTask(input: ScheduledTaskWritable): Promise<ScheduledTaskRecord> {
  const id = input.id?.trim() || fallbackId();
  const scheduleType = input.scheduleType ?? "manual";
  const enabled = input.enabled ?? true;
  const status = enabled ? input.status ?? "idle" : "disabled";
  const nextRunAt =
    input.nextRunAt !== undefined
      ? input.nextRunAt
      : computeNextScheduledRunAt({
          scheduleType,
          enabled,
          runAt: input.runAt,
          intervalSeconds: input.intervalSeconds
        });

  const result = await pool.query(
    `insert into agent.scheduled_tasks (
      id,
      title,
      raw_prompt,
      schedule_type,
      enabled,
      workspace_path,
      routing_mode,
      max_model_calls,
      provider_id,
      agent_config_id,
      run_at,
      interval_seconds,
      next_run_at,
      last_run_at,
      status,
      last_job_id,
      last_error,
      metadata
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13::timestamptz, $14::timestamptz, $15, $16, $17, $18::jsonb)
    on conflict (id) do update set
      title = excluded.title,
      raw_prompt = excluded.raw_prompt,
      schedule_type = excluded.schedule_type,
      enabled = excluded.enabled,
      workspace_path = excluded.workspace_path,
      routing_mode = excluded.routing_mode,
      max_model_calls = excluded.max_model_calls,
      provider_id = excluded.provider_id,
      agent_config_id = excluded.agent_config_id,
      run_at = excluded.run_at,
      interval_seconds = excluded.interval_seconds,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      status = excluded.status,
      last_job_id = excluded.last_job_id,
      last_error = excluded.last_error,
      metadata = excluded.metadata,
      updated_at = now()
    returning *`,
    [
      id,
      input.title,
      input.prompt,
      scheduleType,
      enabled,
      input.workspacePath ?? null,
      input.routingMode ?? DEFAULT_ROUTING_MODE,
      input.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
      input.providerId ?? null,
      input.agentId ?? null,
      input.runAt ?? null,
      input.intervalSeconds ?? null,
      nextRunAt,
      input.lastRunAt ?? null,
      status,
      input.lastJobId ?? null,
      input.lastError ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return toScheduledTaskRecord(result.rows[0]);
}

function shouldRecomputeNextRunAt(input: Partial<ScheduledTaskWritable>) {
  return (
    input.scheduleType !== undefined ||
    input.enabled !== undefined ||
    input.runAt !== undefined ||
    input.intervalSeconds !== undefined
  );
}

export async function patchScheduledTask(
  scheduleId: string,
  input: Partial<ScheduledTaskWritable>
): Promise<ScheduledTaskRecord | null> {
  const current = await getScheduledTask(scheduleId);
  if (!current) {
    return null;
  }

  const nextEnabled = input.enabled ?? current.enabled;
  const nextScheduleType = input.scheduleType ?? current.scheduleType;
  const nextRunAt =
    input.nextRunAt !== undefined
      ? input.nextRunAt
      : shouldRecomputeNextRunAt(input)
        ? computeNextScheduledRunAt({
            scheduleType: nextScheduleType,
            enabled: nextEnabled,
            runAt: input.runAt !== undefined ? input.runAt : current.runAt,
            intervalSeconds:
              input.intervalSeconds !== undefined
                ? input.intervalSeconds
                : current.intervalSeconds
          })
        : current.nextRunAt;

  return upsertScheduledTask({
    id: scheduleId,
    title: input.title ?? current.title,
    prompt: input.prompt ?? current.prompt,
    scheduleType: nextScheduleType,
    enabled: nextEnabled,
    workspacePath: input.workspacePath !== undefined ? input.workspacePath : current.workspacePath,
    routingMode: input.routingMode ?? current.routingMode,
    maxModelCalls: input.maxModelCalls ?? current.maxModelCalls,
    providerId: input.providerId !== undefined ? input.providerId : current.providerId,
    agentId: input.agentId !== undefined ? input.agentId : current.agentId,
    runAt: input.runAt !== undefined ? input.runAt : current.runAt,
    intervalSeconds:
      input.intervalSeconds !== undefined ? input.intervalSeconds : current.intervalSeconds,
    nextRunAt,
    lastRunAt: input.lastRunAt !== undefined ? input.lastRunAt : current.lastRunAt,
    status: nextEnabled ? input.status ?? current.status : "disabled",
    lastJobId: input.lastJobId !== undefined ? input.lastJobId : current.lastJobId,
    lastError: input.lastError !== undefined ? input.lastError : current.lastError,
    metadata: input.metadata ?? current.metadata
  });
}

export async function markScheduledTaskTriggered(input: {
  scheduleId: string;
  jobId: string;
  triggeredAt?: string;
  status?: ScheduledTaskStatus;
  error?: string | null;
}): Promise<ScheduledTaskRecord | null> {
  const current = await getScheduledTask(input.scheduleId);
  if (!current) {
    return null;
  }
  const triggeredAt = input.triggeredAt ?? new Date().toISOString();
  return patchScheduledTask(input.scheduleId, {
    lastRunAt: triggeredAt,
    lastJobId: input.jobId,
    status: input.status ?? "queued",
    lastError: input.error ?? null,
    nextRunAt: computeNextScheduledRunAt(
      {
        scheduleType: current.scheduleType,
        enabled: current.enabled,
        runAt: current.runAt,
        intervalSeconds: current.intervalSeconds
      },
      parseDate(triggeredAt) ?? new Date()
    )
  });
}
