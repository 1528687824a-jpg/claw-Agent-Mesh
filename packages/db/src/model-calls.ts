import { randomUUID } from "node:crypto";
import { pool } from "./pool";

export type ModelCallStatus = "started" | "succeeded" | "failed" | "failed_unknown_outcome";

export type ModelCallRecord = {
  id: string;
  idempotencyKey: string;
  jobId: string;
  stageId: string | null;
  attemptNo: number;
  actionType: string;
  agentId: string;
  agentSessionId: string | null;
  requestHash: string | null;
  status: ModelCallStatus;
  responsePayload: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

function toModelCallRecord(row: any): ModelCallRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    jobId: row.job_id,
    stageId: row.stage_id,
    attemptNo: row.attempt_no,
    actionType: row.action_type,
    agentId: row.agent_id,
    agentSessionId: row.agent_session_id,
    requestHash: row.request_hash,
    status: row.status,
    responsePayload: row.response_payload ?? null,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function getModelCallByKey(idempotencyKey: string): Promise<ModelCallRecord | null> {
  const result = await pool.query(
    `select * from agent.model_calls where idempotency_key = $1`,
    [idempotencyKey]
  );

  return result.rows[0] ? toModelCallRecord(result.rows[0]) : null;
}

export async function markModelCallStarted(input: {
  idempotencyKey: string;
  jobId: string;
  stageId?: string | null;
  attemptNo: number;
  actionType: string;
  agentId: string;
  agentSessionId?: string | null;
  requestHash?: string | null;
}): Promise<ModelCallRecord> {
  const result = await pool.query(
    `insert into agent.model_calls (
      id,
      idempotency_key,
      job_id,
      stage_id,
      attempt_no,
      action_type,
      agent_id,
      agent_session_id,
      request_hash,
      status
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'started')
    on conflict (idempotency_key) do update
      set status = case
            when agent.model_calls.status in ('failed', 'failed_unknown_outcome') then 'started'
            else agent.model_calls.status
          end,
          error = case
            when agent.model_calls.status in ('failed', 'failed_unknown_outcome') then null
            else agent.model_calls.error
          end,
          updated_at = now()
    returning *`,
    [
      `MC-${randomUUID().slice(0, 12).toUpperCase()}`,
      input.idempotencyKey,
      input.jobId,
      input.stageId ?? null,
      input.attemptNo,
      input.actionType,
      input.agentId,
      input.agentSessionId ?? null,
      input.requestHash ?? null
    ]
  );

  return toModelCallRecord(result.rows[0]);
}

export async function markModelCallSucceeded(input: {
  idempotencyKey: string;
  responsePayload: Record<string, unknown>;
}): Promise<ModelCallRecord> {
  const result = await pool.query(
    `update agent.model_calls
     set status = 'succeeded',
         response_payload = $2::jsonb,
         error = null,
         updated_at = now()
     where idempotency_key = $1
     returning *`,
    [input.idempotencyKey, JSON.stringify(input.responsePayload)]
  );

  if (!result.rows[0]) {
    throw new Error(`Model call not found: ${input.idempotencyKey}`);
  }

  return toModelCallRecord(result.rows[0]);
}

export async function markModelCallFailed(input: {
  idempotencyKey: string;
  error: string;
}): Promise<ModelCallRecord | null> {
  const result = await pool.query(
    `update agent.model_calls
     set status = 'failed',
         error = $2,
         updated_at = now()
     where idempotency_key = $1
     returning *`,
    [input.idempotencyKey, input.error]
  );

  return result.rows[0] ? toModelCallRecord(result.rows[0]) : null;
}

export async function markModelCallFailedUnknownOutcome(input: {
  idempotencyKey: string;
  error: string;
}): Promise<ModelCallRecord | null> {
  const result = await pool.query(
    `update agent.model_calls
     set status = 'failed_unknown_outcome',
         error = $2,
         updated_at = now()
     where idempotency_key = $1
       and status = 'started'
     returning *`,
    [input.idempotencyKey, input.error]
  );

  return result.rows[0] ? toModelCallRecord(result.rows[0]) : null;
}
