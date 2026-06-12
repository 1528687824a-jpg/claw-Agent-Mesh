import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  DEFAULT_DISCUSSION_ROUNDS,
  DEFAULT_MAX_MODEL_CALLS,
  DEFAULT_ROUTING_MODE,
  INGRESS_ORIGINS,
  JOB_HEARTBEAT_STATUSES,
  JOB_STATUSES,
  ROUTING_MODES,
  type CreateJobInput,
  type IngressOrigin,
  type JobHeartbeatStatus,
  type JobRecord,
  type RoutingMode,
  type JobStatus
} from "../../shared/src/types";
import { pool } from "./pool";
import { appendAgentEvent } from "./session";

type JobListSort = "createdAt" | "updatedAt";
type JobListOrder = "asc" | "desc";

const ACTIVE_HEARTBEAT_JOB_STATUSES: JobStatus[] = [
  "created",
  "queued",
  "planning",
  "running",
  "testing",
  "fixing"
];

type JobListCursor = {
  sort: JobListSort;
  order: JobListOrder;
  value: string;
  id: string;
};

export class InvalidJobListCursorError extends Error {
  constructor(message = "invalid_job_list_cursor") {
    super(message);
    this.name = "InvalidJobListCursorError";
  }
}

function normalizeRoutingMode(value: unknown): RoutingMode {
  return typeof value === "string" && (ROUTING_MODES as readonly string[]).includes(value)
    ? (value as RoutingMode)
    : DEFAULT_ROUTING_MODE;
}

function normalizeIngressOrigin(value: unknown): IngressOrigin {
  return typeof value === "string" && (INGRESS_ORIGINS as readonly string[]).includes(value)
    ? (value as IngressOrigin)
    : "http";
}

function normalizeIngressOriginFilter(value: unknown): IngressOrigin | null {
  return typeof value === "string" && (INGRESS_ORIGINS as readonly string[]).includes(value)
    ? (value as IngressOrigin)
    : null;
}

function normalizeJobStatus(value: unknown): JobStatus | null {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value)
    ? (value as JobStatus)
    : null;
}

function normalizeJobHeartbeatStatus(value: unknown): JobHeartbeatStatus {
  return typeof value === "string" && (JOB_HEARTBEAT_STATUSES as readonly string[]).includes(value)
    ? (value as JobHeartbeatStatus)
    : "unknown";
}

function heartbeatStatusForJobStatus(status: JobStatus): JobHeartbeatStatus {
  if (status === "succeeded" || status === "failed" || status === "cancelled") {
    return "terminal";
  }
  if (status === "waiting_for_human") {
    return "paused";
  }
  return "healthy";
}

function heartbeatNoteFromPayload(payload: Record<string, unknown>) {
  const reason = payload.reason;
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim().slice(0, 500);
  }
  return null;
}

function normalizeJobListSort(value: unknown): JobListSort {
  return value === "updatedAt" ? "updatedAt" : "createdAt";
}

function normalizeJobListOrder(value: unknown): JobListOrder {
  return value === "asc" ? "asc" : "desc";
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function encodeJobListCursor(cursor: JobListCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeJobListCursor(value: string): JobListCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new InvalidJobListCursorError();
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidJobListCursorError();
  }

  const cursor = parsed as Record<string, unknown>;
  const sort = normalizeJobListSort(cursor.sort);
  const order = normalizeJobListOrder(cursor.order);
  if (
    cursor.sort !== sort ||
    cursor.order !== order ||
    typeof cursor.value !== "string" ||
    Number.isNaN(Date.parse(cursor.value)) ||
    typeof cursor.id !== "string" ||
    !cursor.id
  ) {
    throw new InvalidJobListCursorError();
  }

  return {
    sort,
    order,
    value: cursor.value,
    id: cursor.id
  };
}

function toJobRecord(row: any): JobRecord {
  return {
    id: row.id,
    sessionId: row.session_id ?? row.id,
    ingressOrigin: normalizeIngressOrigin(row.ingress_origin),
    rawPrompt: row.raw_prompt,
    routingMode: normalizeRoutingMode(row.routing_mode),
    maxModelCalls: row.max_model_calls ?? DEFAULT_MAX_MODEL_CALLS,
    classicFinalGateEnabled: row.classic_final_gate_enabled ?? false,
    discussionRounds: row.discussion_rounds ?? DEFAULT_DISCUSSION_ROUNDS,
    status: row.status,
    workflowId: row.workflow_id,
    heartbeatAt: row.heartbeat_at ? row.heartbeat_at.toISOString() : null,
    heartbeatStatus: normalizeJobHeartbeatStatus(row.heartbeat_status),
    heartbeatSource: row.heartbeat_source ?? null,
    heartbeatNote: row.heartbeat_note ?? null,
    stalledAt: row.stalled_at ? row.stalled_at.toISOString() : null,
    finalOutput: row.final_output,
    workdir: row.workdir,
    feishuChatId: row.feishu_chat_id,
    feishuMessageId: row.feishu_message_id,
    requesterId: row.requester_id,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    retentionUntil: row.retention_until ? row.retention_until.toISOString() : null,
    cleanupStatus: row.cleanup_status ?? "active",
    retentionPolicy: row.retention_policy ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  const id = `JOB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;

  const result = await pool.query(
    `insert into agent.jobs (
      id,
      session_id,
      feishu_chat_id,
      feishu_message_id,
      requester_id,
      ingress_origin,
      raw_prompt,
      workdir,
      routing_mode,
      max_model_calls,
      classic_final_gate_enabled,
      discussion_rounds,
      status,
      heartbeat_at,
      heartbeat_status,
      heartbeat_source
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'created', now(), 'healthy', 'job.created')
    returning *`,
    [
      id,
      id,
      input.feishuChatId ?? null,
      input.feishuMessageId ?? null,
      input.requesterId ?? null,
      input.ingressOrigin ?? "http",
      input.rawPrompt,
      input.workdir?.trim() || null,
      input.routingMode ?? DEFAULT_ROUTING_MODE,
      input.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
      input.classicFinalGateEnabled ?? false,
      input.discussionRounds ?? DEFAULT_DISCUSSION_ROUNDS
    ]
  );

  await appendJobEvent(id, "job.created", {
    requesterId: input.requesterId ?? null,
    ingressOrigin: input.ingressOrigin ?? "http",
    workdir: input.workdir?.trim() || null,
    routingMode: input.routingMode ?? DEFAULT_ROUTING_MODE,
    maxModelCalls: input.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
    classicFinalGateEnabled: input.classicFinalGateEnabled ?? false,
    discussionRounds: input.discussionRounds ?? DEFAULT_DISCUSSION_ROUNDS
  });

  return toJobRecord(result.rows[0]);
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  const result = await pool.query(`select * from agent.jobs where id = $1`, [jobId]);
  return result.rows[0] ? toJobRecord(result.rows[0]) : null;
}

export async function getJobBySessionId(sessionId: string): Promise<JobRecord | null> {
  const result = await pool.query(`select * from agent.jobs where session_id = $1`, [sessionId]);
  return result.rows[0] ? toJobRecord(result.rows[0]) : null;
}

export async function listJobs(input: {
  limit?: number;
  status?: string;
  ingressOrigin?: string;
  prompt?: string;
  since?: string;
  until?: string;
  sort?: JobListSort;
  order?: JobListOrder;
  cursor?: string;
} = {}): Promise<{
  jobs: JobRecord[];
  page: {
    limit: number;
    returned: number;
    hasMore: boolean;
    nextCursor: string | null;
    cursor: string | null;
    sort: JobListSort;
    order: JobListOrder;
    filters: {
      status: JobStatus | null;
      ingressOrigin: IngressOrigin | null;
      prompt: string | null;
      since: string | null;
      until: string | null;
    };
  };
}> {
  const values: unknown[] = [];
  const where: string[] = [];
  const status = normalizeJobStatus(input.status);
  const ingressOrigin = normalizeIngressOriginFilter(input.ingressOrigin);
  const prompt = input.prompt?.trim() || null;
  const sort = normalizeJobListSort(input.sort);
  const order = normalizeJobListOrder(input.order);
  const sortColumn = sort === "updatedAt" ? "updated_at" : "created_at";

  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }

  if (input.ingressOrigin && ingressOrigin) {
    values.push(ingressOrigin);
    where.push(`ingress_origin = $${values.length}`);
  }

  if (prompt) {
    values.push(`%${escapeLike(prompt)}%`);
    where.push(`raw_prompt ilike $${values.length} escape '\\'`);
  }

  if (input.since) {
    values.push(input.since);
    where.push(`created_at >= $${values.length}::timestamptz`);
  }

  if (input.until) {
    values.push(input.until);
    where.push(`created_at <= $${values.length}::timestamptz`);
  }

  if (input.cursor) {
    const cursor = decodeJobListCursor(input.cursor);
    if (cursor.sort !== sort || cursor.order !== order) {
      throw new InvalidJobListCursorError("job_list_cursor_sort_mismatch");
    }

    const operator = order === "desc" ? "<" : ">";
    values.push(cursor.value, cursor.id);
    where.push(
      `(${sortColumn}, id) ${operator} ($${values.length - 1}::timestamptz, $${values.length})`
    );
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  values.push(limit + 1);

  const result = await pool.query(
    `select *,
        to_char(${sortColumn} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as __sort_value
     from agent.jobs
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by ${sortColumn} ${order}, id ${order}
     limit $${values.length}`,
    values
  );

  const rows = result.rows.slice(0, limit);
  const hasMore = result.rows.length > limit;
  const lastRow = rows[rows.length - 1] as any | undefined;
  const nextCursor = hasMore && lastRow
    ? encodeJobListCursor({
        sort,
        order,
        value: lastRow.__sort_value,
        id: lastRow.id
      })
    : null;

  return {
    jobs: rows.map(toJobRecord),
    page: {
      limit,
      returned: rows.length,
      hasMore,
      nextCursor,
      cursor: input.cursor ?? null,
      sort,
      order,
      filters: {
        status,
        ingressOrigin,
        prompt,
        since: input.since ?? null,
        until: input.until ?? null
      }
    }
  };
}

export async function getJobByFeishuMessageId(feishuMessageId: string): Promise<JobRecord | null> {
  const result = await pool.query(`select * from agent.jobs where feishu_message_id = $1`, [
    feishuMessageId
  ]);
  return result.rows[0] ? toJobRecord(result.rows[0]) : null;
}

export async function setJobStatus(
  jobId: string,
  status: JobStatus,
  payload: Record<string, unknown> = {}
) {
  const heartbeatStatus = heartbeatStatusForJobStatus(status);
  const result = await pool.query(
    `update agent.jobs
     set status = $2,
         heartbeat_at = now(),
         heartbeat_status = $3,
         heartbeat_source = $4,
         heartbeat_note = $5,
         stalled_at = case
           when $3 in ('healthy', 'paused', 'terminal') then null
           else stalled_at
         end,
         updated_at = now()
     where id = $1
       and (status <> 'cancelled' or $2 = 'cancelled')
     returning id`,
    [jobId, status, heartbeatStatus, `job.${status}`, heartbeatNoteFromPayload(payload)]
  );

  if (result.rowCount === 0) {
    return false;
  }

  await appendJobEvent(jobId, `job.${status}`, payload);
  return true;
}

export async function setJobWorkflowId(jobId: string, workflowId: string) {
  await pool.query(
    `update agent.jobs
     set workflow_id = $2,
         status = 'queued',
         heartbeat_at = now(),
         heartbeat_status = 'healthy',
         heartbeat_source = 'job.workflow_started',
         heartbeat_note = null,
         stalled_at = null,
         updated_at = now()
     where id = $1`,
    [jobId, workflowId]
  );

  await appendJobEvent(jobId, "job.workflow_started", { workflowId });
}

export async function setJobWorkdir(jobId: string, workdir: string) {
  await pool.query(
    `update agent.jobs
     set workdir = $2,
         heartbeat_at = now(),
         heartbeat_status = 'healthy',
         heartbeat_source = 'job.workdir_prepared',
         heartbeat_note = null,
         stalled_at = null,
         updated_at = now()
     where id = $1`,
    [jobId, workdir]
  );

  await appendJobEvent(jobId, "job.workdir_prepared", { workdir });
}

export async function setJobFinalOutput(jobId: string, finalOutput: string) {
  const result = await pool.query(
    `update agent.jobs
     set final_output = $2,
         status = 'succeeded',
         heartbeat_at = now(),
         heartbeat_status = 'terminal',
         heartbeat_source = 'job.succeeded',
         heartbeat_note = null,
         stalled_at = null,
         completed_at = coalesce(completed_at, now()),
         updated_at = now()
     where id = $1
       and status <> 'cancelled'
     returning id`,
    [jobId, finalOutput]
  );

  if (result.rowCount === 0) {
    return false;
  }

  await appendJobEvent(jobId, "job.succeeded", { finalOutput });
  return true;
}

export async function cancelJob(input: {
  jobId: string;
  reason?: string;
  requesterId?: string;
}) {
  const job = await getJob(input.jobId);
  if (!job) {
    return {
      job: null,
      changed: false,
      reason: "job_not_found"
    } as const;
  }

  if (job.status === "succeeded" || job.status === "failed") {
    return {
      job,
      changed: false,
      reason: "already_terminal"
    } as const;
  }

  if (job.status === "cancelled") {
    const archivedJob = job.archivedAt
      ? job
      : await archiveJobSession({
          jobId: input.jobId,
          reason: "job_cancelled"
        });

    return {
      job: archivedJob,
      changed: false,
      reason: "already_cancelled"
    } as const;
  }

  const result = await pool.query(
    `update agent.jobs
     set status = 'cancelled',
         heartbeat_at = now(),
         heartbeat_status = 'terminal',
         heartbeat_source = 'job.cancelled',
         heartbeat_note = $2,
         stalled_at = null,
         completed_at = coalesce(completed_at, now()),
         updated_at = now()
     where id = $1
       and status not in ('succeeded', 'failed', 'cancelled')
     returning *`,
    [input.jobId, input.reason?.trim().slice(0, 500) || null]
  );

  if (!result.rows[0]) {
    const latest = await getJob(input.jobId);
    if (latest?.status === "cancelled" && !latest.archivedAt) {
      const archivedJob = await archiveJobSession({
        jobId: input.jobId,
        reason: "job_cancelled"
      });

      return {
        job: archivedJob,
        changed: false,
        reason: "already_cancelled"
      } as const;
    }

    return {
      job: latest,
      changed: false,
      reason: "not_cancelled"
    } as const;
  }

  await appendJobEvent(
    input.jobId,
    "job.cancelled",
    {
      reason: input.reason ?? null,
      requesterId: input.requesterId ?? null,
      previousStatus: job.status
    },
    {
      actor: "user"
    }
  );

  const archivedJob = await archiveJobSession({
    jobId: input.jobId,
    reason: "job_cancelled"
  });

  return {
    job: archivedJob,
    changed: true,
    reason: "cancelled"
  } as const;
}

export async function archiveJobSession(input: {
  jobId: string;
  retentionDays?: number;
  reason?: string;
}) {
  const retentionDays = input.retentionDays ?? Number(process.env.SESSION_RETENTION_DAYS ?? 30);
  const policy = {
    archiveReason: input.reason ?? "job_completed",
    retentionDays,
    preserve: [
      "agent_events",
      "job_events",
      "final_output",
      "final-summary",
      "pipeline-plan",
      "agent-work-log",
      "lessons/experience files outside job workspace"
    ],
    cleanupAfterRetention: [
      "attempt sandboxes",
      "stage intermediate files",
      "state json sidecars",
      "large temporary artifacts"
    ],
    neverDeleteWithJobCleanup: ["经验库-资料.md", "经验库-文案.md", "经验库-图片.md", "经验库-视频.md"]
  };

  const result = await pool.query(
    `update agent.jobs
     set archived_at = coalesce(archived_at, now()),
         retention_until = coalesce(retention_until, now() + ($2::int * interval '1 day')),
         cleanup_status = case
           when cleanup_status = 'active' then 'retained'
           else cleanup_status
         end,
         retention_policy = $3::jsonb,
         updated_at = now()
     where id = $1
     returning *`,
    [input.jobId, retentionDays, JSON.stringify(policy)]
  );

  const job = toJobRecord(result.rows[0]);
  await appendJobEvent(
    input.jobId,
    "job.archived",
    {
      archivedAt: job.archivedAt,
      retentionUntil: job.retentionUntil,
      cleanupStatus: job.cleanupStatus,
      retentionPolicy: job.retentionPolicy
    },
    {
      actor: "session-ledger"
    }
  );

  return job;
}

export async function restoreJobSession(input: {
  sessionId: string;
  reason?: string;
  requesterId?: string;
}): Promise<JobRecord | null> {
  const result = await pool.query(
    `update agent.jobs
     set archived_at = null,
         retention_until = null,
         cleanup_status = 'active',
         retention_policy = '{}'::jsonb,
         updated_at = now()
     where session_id = $1
     returning *`,
    [input.sessionId]
  );

  if (!result.rows[0]) {
    return null;
  }

  const job = toJobRecord(result.rows[0]);
  await appendJobEvent(
    job.id,
    "session.restored",
    {
      sessionId: input.sessionId,
      reason: input.reason ?? null,
      requesterId: input.requesterId ?? null
    },
    {
      actor: "session-ledger"
    }
  );
  return job;
}

export type JobHeartbeatEntry = Pick<
  JobRecord,
  | "id"
  | "status"
  | "workflowId"
  | "heartbeatAt"
  | "heartbeatStatus"
  | "heartbeatSource"
  | "heartbeatNote"
  | "stalledAt"
  | "updatedAt"
>;

export type JobHeartbeatSummary = {
  checkedAt: string;
  timeoutSeconds: number;
  active: number;
  staleCandidates: number;
  stalled: number;
  paused: number;
  terminal: number;
  oldestActiveHeartbeatAt: string | null;
  recentStalled: JobHeartbeatEntry[];
};

export type JobHeartbeatScanResult = {
  checkedAt: string;
  timeoutSeconds: number;
  scanned: number;
  stalledJobs: JobHeartbeatEntry[];
  summary: JobHeartbeatSummary;
};

function normalizeHeartbeatTimeoutSeconds(value?: number) {
  const fallback = Number(process.env.JOB_HEARTBEAT_TIMEOUT_SECONDS ?? 300);
  const timeoutSeconds = Number.isFinite(value ?? fallback) ? Number(value ?? fallback) : 300;
  return Math.min(Math.max(Math.trunc(timeoutSeconds), 10), 86400);
}

function toHeartbeatEntry(row: any): JobHeartbeatEntry {
  const job = toJobRecord(row);
  return {
    id: job.id,
    status: job.status,
    workflowId: job.workflowId,
    heartbeatAt: job.heartbeatAt,
    heartbeatStatus: job.heartbeatStatus,
    heartbeatSource: job.heartbeatSource,
    heartbeatNote: job.heartbeatNote,
    stalledAt: job.stalledAt,
    updatedAt: job.updatedAt
  };
}

export async function recordJobHeartbeat(input: {
  jobId: string;
  source: string;
  note?: string | null;
  appendEvent?: boolean;
  actor?: string;
  stageId?: string | null;
}) {
  const source = input.source.trim().slice(0, 200) || "heartbeat";
  const note = input.note?.trim().slice(0, 500) || null;
  const result = await pool.query(
    `update agent.jobs
     set heartbeat_at = now(),
         heartbeat_status = 'healthy',
         heartbeat_source = $2,
         heartbeat_note = $3,
         stalled_at = null
     where id = $1
       and status not in ('succeeded', 'failed', 'cancelled', 'waiting_for_human')
     returning *`,
    [input.jobId, source, note]
  );

  if (result.rowCount === 0) {
    return null;
  }

  if (input.appendEvent) {
    await appendJobEvent(
      input.jobId,
      "job.heartbeat",
      {
        source,
        note
      },
      {
        actor: input.actor ?? "heartbeat",
        stageId: input.stageId ?? null
      }
    );
  }

  return toJobRecord(result.rows[0]);
}

export async function getJobHeartbeatSummary(input: {
  timeoutSeconds?: number;
  limit?: number;
} = {}): Promise<JobHeartbeatSummary> {
  const timeoutSeconds = normalizeHeartbeatTimeoutSeconds(input.timeoutSeconds);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
  const activeStatuses = ACTIVE_HEARTBEAT_JOB_STATUSES;

  const [counts, recentStalled] = await Promise.all([
    pool.query(
      `select
         count(*) filter (where status = any($1::text[]))::int as active,
         count(*) filter (
           where status = any($1::text[])
             and coalesce(heartbeat_at, updated_at, created_at) < now() - ($2::int * interval '1 second')
         )::int as stale_candidates,
         count(*) filter (where heartbeat_status = 'stalled')::int as stalled,
         count(*) filter (where heartbeat_status = 'paused')::int as paused,
         count(*) filter (where heartbeat_status = 'terminal')::int as terminal,
         min(coalesce(heartbeat_at, updated_at, created_at)) filter (where status = any($1::text[])) as oldest_active_heartbeat_at
       from agent.jobs`,
      [activeStatuses, timeoutSeconds]
    ),
    pool.query(
      `select *
       from agent.jobs
       where heartbeat_status = 'stalled'
       order by stalled_at desc nulls last, updated_at desc
       limit $1`,
      [limit]
    )
  ]);

  const row = counts.rows[0] ?? {};
  return {
    checkedAt: new Date().toISOString(),
    timeoutSeconds,
    active: Number(row.active ?? 0),
    staleCandidates: Number(row.stale_candidates ?? 0),
    stalled: Number(row.stalled ?? 0),
    paused: Number(row.paused ?? 0),
    terminal: Number(row.terminal ?? 0),
    oldestActiveHeartbeatAt: row.oldest_active_heartbeat_at
      ? row.oldest_active_heartbeat_at.toISOString()
      : null,
    recentStalled: recentStalled.rows.map(toHeartbeatEntry)
  };
}

export async function scanStalledJobHeartbeats(input: {
  timeoutSeconds?: number;
  limit?: number;
} = {}): Promise<JobHeartbeatScanResult> {
  const timeoutSeconds = normalizeHeartbeatTimeoutSeconds(input.timeoutSeconds);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const note = `No heartbeat for at least ${timeoutSeconds} seconds.`;
  const result = await pool.query(
    `with candidates as (
       select id
       from agent.jobs
       where status = any($1::text[])
         and heartbeat_status <> 'stalled'
         and coalesce(heartbeat_at, updated_at, created_at) < now() - ($2::int * interval '1 second')
       order by coalesce(heartbeat_at, updated_at, created_at) asc, created_at asc
       limit $3
     )
     update agent.jobs as jobs
     set heartbeat_status = 'stalled',
         heartbeat_source = 'heartbeat.scan',
         heartbeat_note = $4,
         stalled_at = coalesce(jobs.stalled_at, now())
     from candidates
     where jobs.id = candidates.id
     returning jobs.*`,
    [ACTIVE_HEARTBEAT_JOB_STATUSES, timeoutSeconds, limit, note]
  );

  const stalledJobs = result.rows.map(toHeartbeatEntry);
  for (const job of stalledJobs) {
    await appendJobEvent(
      job.id,
      "job.heartbeat_stalled",
      {
        timeoutSeconds,
        heartbeatAt: job.heartbeatAt,
        heartbeatSource: job.heartbeatSource,
        note
      },
      {
        actor: "heartbeat-monitor"
      }
    );
  }

  return {
    checkedAt: new Date().toISOString(),
    timeoutSeconds,
    scanned: stalledJobs.length,
    stalledJobs,
    summary: await getJobHeartbeatSummary({
      timeoutSeconds,
      limit: Math.min(limit, 100)
    })
  };
}

export async function appendJobEvent(
  jobId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
  options: {
    actor?: string;
    stageId?: string | null;
    artifactId?: string | null;
    groupMessageId?: string | null;
    feishuMessageId?: string | null;
  } = {}
) {
  await pool.query(
    `insert into agent.job_events (job_id, event_type, payload)
     values ($1, $2, $3::jsonb)`,
    [jobId, eventType, JSON.stringify(payload)]
  );

  const job = await getJob(jobId);
  if (!job) {
    return;
  }

  await appendAgentEvent({
    sessionId: job.sessionId,
    jobId,
    actor: options.actor ?? "system",
    eventType,
    payload,
    stageId: options.stageId ?? null,
    artifactId: options.artifactId ?? null,
    groupMessageId: options.groupMessageId ?? null,
    feishuMessageId: options.feishuMessageId ?? null
  });
}
