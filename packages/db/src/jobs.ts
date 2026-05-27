import { randomUUID } from "node:crypto";
import {
  DEFAULT_DISCUSSION_ROUNDS,
  DEFAULT_MAX_MODEL_CALLS,
  DEFAULT_ROUTING_MODE,
  ROUTING_MODES,
  type CreateJobInput,
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

function toJobRecord(row: any): JobRecord {
  return {
    id: row.id,
    sessionId: row.session_id ?? row.id,
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
      raw_prompt,
      routing_mode,
      max_model_calls,
      classic_final_gate_enabled,
      discussion_rounds,
      status
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'created')
    returning *`,
    [
      id,
      id,
      input.feishuChatId ?? null,
      input.feishuMessageId ?? null,
      input.requesterId ?? null,
      input.rawPrompt,
      input.routingMode ?? DEFAULT_ROUTING_MODE,
      input.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
      input.classicFinalGateEnabled ?? false,
      input.discussionRounds ?? DEFAULT_DISCUSSION_ROUNDS
    ]
  );

  await appendJobEvent(id, "job.created", {
    requesterId: input.requesterId ?? null,
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
  await pool.query(
    `update agent.jobs
     set status = $2, updated_at = now()
     where id = $1`,
    [jobId, status]
  );

  await appendJobEvent(jobId, `job.${status}`, payload);
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
  await pool.query(
    `update agent.jobs
     set final_output = $2,
         status = 'succeeded',
         completed_at = coalesce(completed_at, now()),
         updated_at = now()
     where id = $1`,
    [jobId, finalOutput]
  );

  await appendJobEvent(jobId, "job.succeeded", { finalOutput });
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
