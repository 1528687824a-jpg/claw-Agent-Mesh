import { randomUUID } from "node:crypto";
import type {
  ArtifactRecord,
  ArtifactType,
  GroupMessageRecord,
  GroupMessageType,
  StageDefinition,
  StageRecord,
  StageStatus,
  TestVerdict
} from "../../shared/src/types";
import { appendJobEvent } from "./jobs";
import { pool } from "./pool";
import { getAgentEventsForJob } from "./session";

function toStageRecord(row: any): StageRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    stageIndex: row.stage_index,
    stageType: row.stage_type,
    agentId: row.agent_id,
    name: row.name,
    status: row.status,
    inputArtifactId: row.input_artifact_id,
    outputArtifactId: row.output_artifact_id,
    acceptanceCriteria: row.acceptance_criteria ?? [],
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    originalAgentSessionId: row.original_agent_session_id,
    originalTestSessionId: row.original_test_session_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toArtifactRecord(row: any): ArtifactRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    stageId: row.stage_id,
    type: row.type,
    title: row.title,
    content: row.content,
    uri: row.uri,
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString()
  };
}

function toGroupMessageRecord(row: any): GroupMessageRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    stageId: row.stage_id,
    senderAgentId: row.sender_agent_id,
    mentionAgentId: row.mention_agent_id,
    messageType: row.message_type,
    content: row.content,
    artifactId: row.artifact_id,
    feishuMessageId: row.feishu_message_id,
    createdAt: row.created_at.toISOString()
  };
}

export async function createArtifact(input: {
  jobId: string;
  stageId?: string | null;
  type: ArtifactType;
  title?: string;
  content?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
  id?: string;
}): Promise<ArtifactRecord> {
  const id = input.id ?? `ART-${randomUUID().slice(0, 12).toUpperCase()}`;
  const result = await pool.query(
    `insert into agent.artifacts (
      id, job_id, stage_id, type, title, content, uri, metadata
    ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    on conflict (id) do update
      set title = excluded.title,
          content = excluded.content,
          uri = excluded.uri,
          metadata = excluded.metadata
    returning *`,
    [
      id,
      input.jobId,
      input.stageId ?? null,
      input.type,
      input.title ?? null,
      input.content ?? null,
      input.uri ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const artifact = toArtifactRecord(result.rows[0]);
  await appendJobEvent(
    input.jobId,
    "artifact.upserted",
    {
      artifactId: artifact.id,
      stageId: input.stageId ?? null,
      type: input.type,
      title: input.title ?? null,
      uri: input.uri ?? null
    },
    {
      actor: "artifact-store",
      stageId: input.stageId ?? null,
      artifactId: artifact.id
    }
  );

  return artifact;
}

export async function getArtifact(artifactId: string): Promise<ArtifactRecord> {
  const result = await pool.query(`select * from agent.artifacts where id = $1`, [artifactId]);
  if (!result.rows[0]) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }
  return toArtifactRecord(result.rows[0]);
}

export async function createGroupMessage(input: {
  jobId: string;
  stageId?: string | null;
  senderAgentId: string;
  mentionAgentId?: string | null;
  messageType: GroupMessageType;
  content: string;
  artifactId?: string | null;
  feishuMessageId?: string | null;
  id?: string;
}): Promise<GroupMessageRecord> {
  const id = input.id ?? `MSG-${randomUUID().slice(0, 12).toUpperCase()}`;
  const result = await pool.query(
    `insert into agent.group_messages (
      id,
      job_id,
      stage_id,
      sender_agent_id,
      mention_agent_id,
      message_type,
      content,
      artifact_id,
      feishu_message_id
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    on conflict (id) do update
      set content = excluded.content,
          artifact_id = excluded.artifact_id,
          feishu_message_id = coalesce(agent.group_messages.feishu_message_id, excluded.feishu_message_id)
    returning *`,
    [
      id,
      input.jobId,
      input.stageId ?? null,
      input.senderAgentId,
      input.mentionAgentId ?? null,
      input.messageType,
      input.content,
      input.artifactId ?? null,
      input.feishuMessageId ?? null
    ]
  );

  await appendJobEvent(input.jobId, "group.message_created", {
    messageId: id,
    stageId: input.stageId ?? null,
    senderAgentId: input.senderAgentId,
    mentionAgentId: input.mentionAgentId ?? null,
    messageType: input.messageType,
    artifactId: input.artifactId ?? null
  }, {
    actor: input.senderAgentId,
    stageId: input.stageId ?? null,
    artifactId: input.artifactId ?? null,
    groupMessageId: id,
    feishuMessageId: input.feishuMessageId ?? null
  });

  return toGroupMessageRecord(result.rows[0]);
}

export async function setGroupMessageFeishuId(input: {
  groupMessageId: string;
  jobId: string;
  feishuMessageId: string;
}) {
  await pool.query(`update agent.group_messages set feishu_message_id = $2 where id = $1`, [
    input.groupMessageId,
    input.feishuMessageId
  ]);

  await appendJobEvent(
    input.jobId,
    "group.message_delivered",
    {
      messageId: input.groupMessageId
    },
    {
      actor: "feishu-gateway",
      groupMessageId: input.groupMessageId,
      feishuMessageId: input.feishuMessageId
    }
  );
}

export async function getGroupMessagesForJob(jobId: string): Promise<GroupMessageRecord[]> {
  const result = await pool.query(
    `select * from agent.group_messages where job_id = $1 order by created_at`,
    [jobId]
  );
  return result.rows.map(toGroupMessageRecord);
}

export async function createPipelineStages(
  jobId: string,
  definitions: StageDefinition[],
  inputArtifactId?: string
): Promise<StageRecord[]> {
  const stages: StageRecord[] = [];

  for (const [index, definition] of definitions.entries()) {
    const stageIndex = index + 1;
    const id = `${jobId}-STAGE-${stageIndex.toString().padStart(3, "0")}`;
    const result = await pool.query(
      `insert into agent.job_stages (
        id,
        job_id,
        stage_index,
        stage_type,
        agent_id,
        name,
        status,
        input_artifact_id,
        acceptance_criteria,
        max_retries
      ) values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8::jsonb, $9)
      on conflict (job_id, stage_index) do update
        set stage_type = excluded.stage_type,
            agent_id = excluded.agent_id,
            name = excluded.name,
            input_artifact_id = coalesce(agent.job_stages.input_artifact_id, excluded.input_artifact_id),
            acceptance_criteria = excluded.acceptance_criteria,
            max_retries = excluded.max_retries,
            updated_at = now()
      returning *`,
      [
        id,
        jobId,
        stageIndex,
        definition.stageType,
        definition.agentId,
        definition.name,
        stageIndex === 1 ? inputArtifactId ?? null : null,
        JSON.stringify(definition.acceptanceCriteria),
        definition.maxRetries ?? 3
      ]
    );

    stages.push(toStageRecord(result.rows[0]));
  }

  await appendJobEvent(jobId, "pipeline.stages_created", {
    stageCount: stages.length,
    stages: stages.map((stage) => ({
      id: stage.id,
      agentId: stage.agentId,
      name: stage.name
    }))
  });

  return stages;
}

export async function getStagesForJob(jobId: string): Promise<StageRecord[]> {
  const result = await pool.query(
    `select * from agent.job_stages where job_id = $1 order by stage_index`,
    [jobId]
  );
  return result.rows.map(toStageRecord);
}

export async function getStage(stageId: string): Promise<StageRecord> {
  const result = await pool.query(`select * from agent.job_stages where id = $1`, [stageId]);
  if (!result.rows[0]) {
    throw new Error(`Stage not found: ${stageId}`);
  }
  return toStageRecord(result.rows[0]);
}

export async function setStageStatus(stageId: string, status: StageStatus) {
  const stage = await getStage(stageId);
  await pool.query(
    `update agent.job_stages
     set status = $2, updated_at = now()
     where id = $1`,
    [stageId, status]
  );

  await appendJobEvent(
    stage.jobId,
    "stage.status_changed",
    {
      stageId,
      status
    },
    {
      actor: "dbos-harness",
      stageId
    }
  );
}

export async function startStageAttempt(input: {
  stageId: string;
  attemptNo: number;
  agentId: string;
  agentSessionId: string;
  inputArtifactId?: string | null;
}) {
  const id = `${input.stageId}-ATTEMPT-${input.attemptNo.toString().padStart(2, "0")}`;
  await pool.query(
    `insert into agent.stage_attempts (
      id, stage_id, attempt_no, agent_id, agent_session_id, input_artifact_id, status, started_at
    ) values ($1, $2, $3, $4, $5, $6, 'running', now())
    on conflict (stage_id, attempt_no) do update
      set agent_session_id = excluded.agent_session_id,
          input_artifact_id = excluded.input_artifact_id,
          status = 'running',
          error = null,
          started_at = coalesce(agent.stage_attempts.started_at, now())
    returning *`,
    [
      id,
      input.stageId,
      input.attemptNo,
      input.agentId,
      input.agentSessionId,
      input.inputArtifactId ?? null
    ]
  );

  await pool.query(
    `update agent.job_stages
     set original_agent_session_id = coalesce(original_agent_session_id, $2),
         status = 'running',
         updated_at = now()
     where id = $1`,
    [input.stageId, input.agentSessionId]
  );

  return id;
}

export async function completeStageAttempt(input: {
  attemptId: string;
  stageId: string;
  outputArtifactId: string;
  status: "completed" | "failed";
  error?: string;
}) {
  await pool.query(
    `update agent.stage_attempts
     set output_artifact_id = $2,
         status = $3,
         error = $4,
         finished_at = now()
     where id = $1`,
    [input.attemptId, input.outputArtifactId, input.status, input.error ?? null]
  );

  await pool.query(
    `update agent.job_stages
     set output_artifact_id = $2,
         status = 'test_pending',
         updated_at = now()
     where id = $1`,
    [input.stageId, input.outputArtifactId]
  );
}

export async function saveTestReview(input: {
  stageId: string;
  attemptId: string;
  attemptNo: number;
  testAgentId: string;
  testAgentSessionId: string;
  verdict: TestVerdict;
  issueCount: number;
  reportArtifactId: string;
  requiredFixes: string[];
}) {
  const id = `${input.stageId}-REVIEW-${input.attemptNo.toString().padStart(2, "0")}`;
  await pool.query(
    `insert into agent.test_reviews (
      id,
      stage_id,
      attempt_id,
      test_agent_id,
      test_agent_session_id,
      verdict,
      issue_count,
      report_artifact_id,
      required_fixes
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    on conflict (id) do update
      set verdict = excluded.verdict,
          issue_count = excluded.issue_count,
          report_artifact_id = excluded.report_artifact_id,
          required_fixes = excluded.required_fixes`,
    [
      id,
      input.stageId,
      input.attemptId,
      input.testAgentId,
      input.testAgentSessionId,
      input.verdict,
      input.issueCount,
      input.reportArtifactId,
      JSON.stringify(input.requiredFixes)
    ]
  );

  await pool.query(
    `update agent.job_stages
     set original_test_session_id = coalesce(original_test_session_id, $2),
         status = $3,
         retry_count = case when $4 = 'FAIL_RETRYABLE' then $5 else retry_count end,
         updated_at = now()
     where id = $1`,
    [
      input.stageId,
      input.testAgentSessionId,
      input.verdict === "PASS" ? "test_passed" : "test_failed",
      input.verdict,
      input.attemptNo
    ]
  );

  return id;
}

export async function markStageCompleted(stageId: string) {
  await pool.query(
    `update agent.job_stages
     set status = 'completed', updated_at = now()
     where id = $1`,
    [stageId]
  );
}

export async function markStageFixing(stageId: string) {
  await setStageStatus(stageId, "fixing");
}

export async function markStageWaitingForHuman(stageId: string) {
  await setStageStatus(stageId, "waiting_for_human");
}

export async function setNextStageInput(currentStageId: string, outputArtifactId: string) {
  const stage = await getStage(currentStageId);
  await pool.query(
    `update agent.job_stages
     set input_artifact_id = $3,
         updated_at = now()
     where job_id = $1 and stage_index = $2`,
    [stage.jobId, stage.stageIndex + 1, outputArtifactId]
  );
}

export async function getNextStage(stageId: string): Promise<StageRecord | null> {
  const stage = await getStage(stageId);
  const result = await pool.query(
    `select *
     from agent.job_stages
     where job_id = $1 and stage_index = $2`,
    [stage.jobId, stage.stageIndex + 1]
  );

  return result.rows[0] ? toStageRecord(result.rows[0]) : null;
}

export async function getJobDetails(jobId: string) {
  const [job, stages, attempts, reviews, artifacts, groupMessages, events, agentEvents] = await Promise.all([
    pool.query(`select * from agent.jobs where id = $1`, [jobId]),
    pool.query(`select * from agent.job_stages where job_id = $1 order by stage_index`, [jobId]),
    pool.query(
      `select a.*
       from agent.stage_attempts a
       join agent.job_stages s on s.id = a.stage_id
       where s.job_id = $1
       order by s.stage_index, a.attempt_no`,
      [jobId]
    ),
    pool.query(
      `select r.*
       from agent.test_reviews r
       join agent.job_stages s on s.id = r.stage_id
       where s.job_id = $1
       order by s.stage_index, r.created_at`,
      [jobId]
    ),
    pool.query(`select * from agent.artifacts where job_id = $1 order by created_at`, [jobId]),
    pool.query(`select * from agent.group_messages where job_id = $1 order by created_at`, [jobId]),
    pool.query(`select * from agent.job_events where job_id = $1 order by id`, [jobId]),
    getAgentEventsForJob(jobId)
  ]);

  return {
    job: job.rows[0] ?? null,
    stages: stages.rows,
    attempts: attempts.rows,
    reviews: reviews.rows,
    artifacts: artifacts.rows,
    groupMessages: groupMessages.rows,
    events: events.rows,
    agentEvents
  };
}
