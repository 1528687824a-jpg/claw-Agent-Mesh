import { randomUUID } from "node:crypto";
import {
  DEFAULT_DISCUSSION_ROUNDS,
  DEFAULT_MAX_MODEL_CALLS,
  DEFAULT_ROUTING_MODE,
  INGRESS_ORIGINS,
  JOB_STATUSES,
  ROUTING_MODES,
  type CreateJobInput,
  type IngressOrigin,
  type JobRecord,
  type RoutingMode,
  type JobStatus
} from "../../shared/src/types";
import { pool } from "./pool";
import { appendAgentEvent } from "./session";

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
      routing_mode,
      max_model_calls,
      classic_final_gate_enabled,
      discussion_rounds,
      status
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'created')
    returning *`,
    [
      id,
      id,
      input.feishuChatId ?? null,
      input.feishuMessageId ?? null,
      input.requesterId ?? null,
      input.ingressOrigin ?? "http",
      input.rawPrompt,
      input.routingMode ?? DEFAULT_ROUTING_MODE,
      input.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
      input.classicFinalGateEnabled ?? false,
      input.discussionRounds ?? DEFAULT_DISCUSSION_ROUNDS
    ]
  );

  await appendJobEvent(id, "job.created", {
    requesterId: input.requesterId ?? null,
    ingressOrigin: input.ingressOrigin ?? "http",
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

export async function listJobs(input: {
  limit?: number;
  status?: string;
  ingressOrigin?: string;
} = {}): Promise<JobRecord[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  const status = normalizeJobStatus(input.status);
  const ingressOrigin = normalizeIngressOriginFilter(input.ingressOrigin);

  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }

  if (input.ingressOrigin && ingressOrigin) {
    values.push(ingressOrigin);
    where.push(`ingress_origin = $${values.length}`);
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  values.push(limit);

  const result = await pool.query(
    `select *
     from agent.jobs
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by created_at desc
     limit $${values.length}`,
    values
  );

  return result.rows.map(toJobRecord);
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
  const result = await pool.query(
    `update agent.jobs
     set status = $2, updated_at = now()
     where id = $1
       and (status <> 'cancelled' or $2 = 'cancelled')
     returning id`,
    [jobId, status]
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
     set workflow_id = $2, status = 'queued', updated_at = now()
     where id = $1`,
    [jobId, workflowId]
  );

  await appendJobEvent(jobId, "job.workflow_started", { workflowId });
}

export async function setJobWorkdir(jobId: string, workdir: string) {
  await pool.query(
    `update agent.jobs
     set workdir = $2, updated_at = now()
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
    return {
      job,
      changed: false,
      reason: "already_cancelled"
    } as const;
  }

  const result = await pool.query(
    `update agent.jobs
     set status = 'cancelled',
         completed_at = coalesce(completed_at, now()),
         updated_at = now()
     where id = $1
       and status not in ('succeeded', 'failed', 'cancelled')
     returning *`,
    [input.jobId]
  );

  if (!result.rows[0]) {
    const latest = await getJob(input.jobId);
    return {
      job: latest,
      changed: false,
      reason: "not_cancelled"
    } as const;
  }

  const cancelled = toJobRecord(result.rows[0]);
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

  return {
    job: cancelled,
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
