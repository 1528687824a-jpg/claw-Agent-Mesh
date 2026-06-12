import { pool } from "./pool";
import { createArtifact } from "./pipeline";

export type RuntimeLogSource = "job_event" | "agent_event" | "model_call";

export type RuntimeLogEntry = {
  id: string;
  source: RuntimeLogSource;
  at: string;
  jobId: string;
  sessionId: string | null;
  stageId: string | null;
  actor: string | null;
  agentId: string | null;
  eventType: string;
  status: string | null;
  title: string;
  payload: Record<string, unknown> | null;
  error: string | null;
};

export type RuntimeLogsResponse = {
  entries: RuntimeLogEntry[];
  filters: {
    source: RuntimeLogSource | null;
    jobId: string | null;
    sessionId: string | null;
    since: string | null;
    until: string | null;
    limit: number;
  };
};

export type RuntimeUsageResponse = {
  summary: {
    jobs: {
      total: number;
      running: number;
      waiting: number;
      succeeded: number;
      failed: number;
      cancelled: number;
    };
    modelCalls: {
      total: number;
      started: number;
      succeeded: number;
      failed: number;
      failedUnknownOutcome: number;
    };
    tokens: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      callsWithUsage: number;
    };
    events: {
      jobEvents: number;
      agentEvents: number;
      groupMessages: number;
      artifacts: number;
    };
  };
  byAgent: Array<{
    agentId: string;
    total: number;
    succeeded: number;
    failed: number;
    started: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
  byDay: Array<{
    day: string;
    total: number;
    succeeded: number;
    failed: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
  byActionType: Array<{
    actionType: string;
    total: number;
    succeeded: number;
    failed: number;
    started: number;
  }>;
  recentFailures: Array<{
    id: string;
    jobId: string;
    agentId: string;
    actionType: string;
    status: string;
    error: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  filters: {
    since: string | null;
    until: string | null;
  };
};

export type SessionSummary = {
  sessionId: string;
  jobId: string;
  status: string;
  routingMode: string;
  rawPrompt: string;
  workdir: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  eventCount: number;
  modelCallCount: number;
  groupMessageCount: number;
  artifactCount: number;
};

export type SessionListResponse = {
  sessions: SessionSummary[];
  filters: {
    status: string | null;
    prompt: string | null;
    limit: number;
  };
};

export type SessionEventRecord = {
  id: string;
  sessionId: string;
  jobId: string;
  stageId: string | null;
  seq: number;
  actor: string;
  eventType: string;
  payload: Record<string, unknown>;
  artifactId: string | null;
  groupMessageId: string | null;
  feishuMessageId: string | null;
  createdAt: string;
};

export type SessionCompressionResponse = {
  sessionId: string;
  jobId: string;
  artifactId: string;
  summary: string;
  counts: {
    events: number;
    modelCalls: number;
    groupMessages: number;
    artifacts: number;
  };
};

function toRuntimeLogEntry(row: any): RuntimeLogEntry {
  return {
    id: row.id,
    source: row.source,
    at: row.at.toISOString(),
    jobId: row.job_id,
    sessionId: row.session_id,
    stageId: row.stage_id,
    actor: row.actor,
    agentId: row.agent_id,
    eventType: row.event_type,
    status: row.status,
    title: row.title,
    payload: row.payload ?? null,
    error: row.error
  };
}

function toSessionSummary(row: any): SessionSummary {
  return {
    sessionId: row.session_id,
    jobId: row.job_id,
    status: row.status,
    routingMode: row.routing_mode,
    rawPrompt: row.raw_prompt,
    workdir: row.workdir,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    eventCount: Number(row.event_count ?? 0),
    modelCallCount: Number(row.model_call_count ?? 0),
    groupMessageCount: Number(row.group_message_count ?? 0),
    artifactCount: Number(row.artifact_count ?? 0)
  };
}

function toSessionEventRecord(row: any): SessionEventRecord {
  return {
    id: String(row.id),
    sessionId: row.session_id,
    jobId: row.job_id,
    stageId: row.stage_id,
    seq: row.seq,
    actor: row.actor,
    eventType: row.event_type,
    payload: row.payload ?? {},
    artifactId: row.artifact_id,
    groupMessageId: row.group_message_id,
    feishuMessageId: row.feishu_message_id,
    createdAt: row.created_at.toISOString()
  };
}

function appendTimeFilters(
  values: unknown[],
  where: string[],
  column: string,
  input: { since?: string; until?: string }
) {
  if (input.since) {
    values.push(input.since);
    where.push(`${column} >= $${values.length}::timestamptz`);
  }
  if (input.until) {
    values.push(input.until);
    where.push(`${column} <= $${values.length}::timestamptz`);
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function listRuntimeLogs(input: {
  source?: RuntimeLogSource;
  jobId?: string;
  sessionId?: string;
  since?: string;
  until?: string;
  limit?: number;
} = {}): Promise<RuntimeLogsResponse> {
  const values: unknown[] = [];
  const where: string[] = [];
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

  if (input.source) {
    values.push(input.source);
    where.push(`source = $${values.length}`);
  }
  if (input.jobId) {
    values.push(input.jobId);
    where.push(`job_id = $${values.length}`);
  }
  if (input.sessionId) {
    values.push(input.sessionId);
    where.push(`session_id = $${values.length}`);
  }
  appendTimeFilters(values, where, "at", input);
  values.push(limit);

  const result = await pool.query(
    `select *
     from (
       select
         'job_event:' || je.id::text as id,
         'job_event' as source,
         je.created_at as at,
         je.job_id,
         j.session_id,
         null::text as stage_id,
         'system'::text as actor,
         null::text as agent_id,
         je.event_type,
         null::text as status,
         je.event_type as title,
         je.payload,
         null::text as error
       from agent.job_events je
       left join agent.jobs j on j.id = je.job_id

       union all

       select
         'agent_event:' || ae.id::text as id,
         'agent_event' as source,
         ae.created_at as at,
         ae.job_id,
         ae.session_id,
         ae.stage_id,
         ae.actor,
         ae.actor as agent_id,
         ae.event_type,
         null::text as status,
         ae.event_type as title,
         ae.payload,
         null::text as error
       from agent.agent_events ae

       union all

       select
         'model_call:' || mc.id as id,
         'model_call' as source,
         mc.created_at as at,
         mc.job_id,
         mc.agent_session_id as session_id,
         mc.stage_id,
         mc.agent_id as actor,
         mc.agent_id,
         mc.action_type as event_type,
         mc.status,
         mc.action_type as title,
         mc.response_payload as payload,
         mc.error
       from agent.model_calls mc
     ) runtime_logs
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by at desc, id desc
     limit $${values.length}`,
    values
  );

  return {
    entries: result.rows.map(toRuntimeLogEntry),
    filters: {
      source: input.source ?? null,
      jobId: input.jobId ?? null,
      sessionId: input.sessionId ?? null,
      since: input.since ?? null,
      until: input.until ?? null,
      limit
    }
  };
}

export async function getRuntimeUsage(input: {
  since?: string;
  until?: string;
} = {}): Promise<RuntimeUsageResponse> {
  const values: unknown[] = [];
  const timeWhere: string[] = [];
  appendTimeFilters(values, timeWhere, "created_at", input);
  const whereSql = timeWhere.length ? `where ${timeWhere.join(" and ")}` : "";

  // Token usage lives in response_payload->result->usage, written by the
  // OpenClaw adapter for real-mode calls; mock calls have no usage object.
  const usagePath = `response_payload->'result'->'usage'`;
  const tokenSums = `
    coalesce(sum((${usagePath}->>'promptTokens')::bigint), 0)::bigint as prompt_tokens,
    coalesce(sum((${usagePath}->>'completionTokens')::bigint), 0)::bigint as completion_tokens,
    coalesce(sum((${usagePath}->>'totalTokens')::bigint), 0)::bigint as total_tokens`;

  const [jobs, modelCalls, events, byAgent, byActionType, recentFailures, tokens, byDay] = await Promise.all([
    pool.query(
      `select
         count(*)::int as total,
         count(*) filter (where status in ('queued', 'planning', 'running', 'testing', 'fixing'))::int as running,
         count(*) filter (where status = 'waiting_for_human')::int as waiting,
         count(*) filter (where status = 'succeeded')::int as succeeded,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where status = 'cancelled')::int as cancelled
       from agent.jobs
       ${whereSql}`,
      values
    ),
    pool.query(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'started')::int as started,
         count(*) filter (where status = 'succeeded')::int as succeeded,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where status = 'failed_unknown_outcome')::int as failed_unknown_outcome
       from agent.model_calls
       ${whereSql}`,
      values
    ),
    pool.query(
      `select
         (select count(*)::int from agent.job_events ${whereSql}) as job_events,
         (select count(*)::int from agent.agent_events ${whereSql}) as agent_events,
         (select count(*)::int from agent.group_messages ${whereSql}) as group_messages,
         (select count(*)::int from agent.artifacts ${whereSql}) as artifacts`,
      values
    ),
    pool.query(
      `select
         agent_id,
         count(*)::int as total,
         count(*) filter (where status = 'succeeded')::int as succeeded,
         count(*) filter (where status in ('failed', 'failed_unknown_outcome'))::int as failed,
         count(*) filter (where status = 'started')::int as started,
         ${tokenSums}
       from agent.model_calls
       ${whereSql}
       group by agent_id
       order by total desc, agent_id asc
       limit 50`,
      values
    ),
    pool.query(
      `select
         action_type,
         count(*)::int as total,
         count(*) filter (where status = 'succeeded')::int as succeeded,
         count(*) filter (where status in ('failed', 'failed_unknown_outcome'))::int as failed,
         count(*) filter (where status = 'started')::int as started
       from agent.model_calls
       ${whereSql}
       group by action_type
       order by total desc, action_type asc
       limit 50`,
      values
    ),
    pool.query(
      `select id, job_id, agent_id, action_type, status, error, created_at, updated_at
       from agent.model_calls
       ${whereSql ? `${whereSql} and` : "where"} status in ('failed', 'failed_unknown_outcome')
       order by updated_at desc
       limit 20`,
      values
    ),
    pool.query(
      `select
         count(*) filter (where ${usagePath} is not null)::int as calls_with_usage,
         ${tokenSums}
       from agent.model_calls
       ${whereSql}`,
      values
    ),
    pool.query(
      `select
         to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
         count(*)::int as total,
         count(*) filter (where status = 'succeeded')::int as succeeded,
         count(*) filter (where status in ('failed', 'failed_unknown_outcome'))::int as failed,
         ${tokenSums}
       from agent.model_calls
       ${whereSql}
       group by 1
       order by 1 desc
       limit 60`,
      values
    )
  ]);

  const jobRow = jobs.rows[0] ?? {};
  const modelRow = modelCalls.rows[0] ?? {};
  const eventRow = events.rows[0] ?? {};

  return {
    summary: {
      jobs: {
        total: Number(jobRow.total ?? 0),
        running: Number(jobRow.running ?? 0),
        waiting: Number(jobRow.waiting ?? 0),
        succeeded: Number(jobRow.succeeded ?? 0),
        failed: Number(jobRow.failed ?? 0),
        cancelled: Number(jobRow.cancelled ?? 0)
      },
      modelCalls: {
        total: Number(modelRow.total ?? 0),
        started: Number(modelRow.started ?? 0),
        succeeded: Number(modelRow.succeeded ?? 0),
        failed: Number(modelRow.failed ?? 0),
        failedUnknownOutcome: Number(modelRow.failed_unknown_outcome ?? 0)
      },
      tokens: {
        promptTokens: Number(tokens.rows[0]?.prompt_tokens ?? 0),
        completionTokens: Number(tokens.rows[0]?.completion_tokens ?? 0),
        totalTokens: Number(tokens.rows[0]?.total_tokens ?? 0),
        callsWithUsage: Number(tokens.rows[0]?.calls_with_usage ?? 0)
      },
      events: {
        jobEvents: Number(eventRow.job_events ?? 0),
        agentEvents: Number(eventRow.agent_events ?? 0),
        groupMessages: Number(eventRow.group_messages ?? 0),
        artifacts: Number(eventRow.artifacts ?? 0)
      }
    },
    byAgent: byAgent.rows.map((row) => ({
      agentId: row.agent_id,
      total: Number(row.total ?? 0),
      succeeded: Number(row.succeeded ?? 0),
      failed: Number(row.failed ?? 0),
      started: Number(row.started ?? 0),
      promptTokens: Number(row.prompt_tokens ?? 0),
      completionTokens: Number(row.completion_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0)
    })),
    byDay: byDay.rows.map((row) => ({
      day: row.day,
      total: Number(row.total ?? 0),
      succeeded: Number(row.succeeded ?? 0),
      failed: Number(row.failed ?? 0),
      promptTokens: Number(row.prompt_tokens ?? 0),
      completionTokens: Number(row.completion_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0)
    })),
    byActionType: byActionType.rows.map((row) => ({
      actionType: row.action_type,
      total: Number(row.total ?? 0),
      succeeded: Number(row.succeeded ?? 0),
      failed: Number(row.failed ?? 0),
      started: Number(row.started ?? 0)
    })),
    recentFailures: recentFailures.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      agentId: row.agent_id,
      actionType: row.action_type,
      status: row.status,
      error: row.error,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    })),
    filters: {
      since: input.since ?? null,
      until: input.until ?? null
    }
  };
}

export async function listSessions(input: {
  status?: string;
  prompt?: string;
  limit?: number;
} = {}): Promise<SessionListResponse> {
  const values: unknown[] = [];
  const where: string[] = [`session_id is not null`];
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  if (input.status) {
    values.push(input.status);
    where.push(`status = $${values.length}`);
  }
  if (input.prompt) {
    values.push(`%${escapeLike(input.prompt)}%`);
    where.push(`raw_prompt ilike $${values.length} escape '\\'`);
  }
  values.push(limit);

  const result = await pool.query(
    `select
       j.id as job_id,
       j.session_id,
       j.status,
       j.routing_mode,
       j.raw_prompt,
       j.workdir,
       j.created_at,
       j.updated_at,
       j.completed_at,
       (select count(*)::int from agent.agent_events ae where ae.session_id = j.session_id) as event_count,
       (select count(*)::int from agent.model_calls mc where mc.job_id = j.id) as model_call_count,
       (select count(*)::int from agent.group_messages gm where gm.job_id = j.id) as group_message_count,
       (select count(*)::int from agent.artifacts a where a.job_id = j.id) as artifact_count
     from agent.jobs j
     where ${where.join(" and ")}
     order by j.updated_at desc, j.id desc
     limit $${values.length}`,
    values
  );

  return {
    sessions: result.rows.map(toSessionSummary),
    filters: {
      status: input.status ?? null,
      prompt: input.prompt ?? null,
      limit
    }
  };
}

export async function getSessionEvents(
  sessionId: string,
  input: { limit?: number } = {}
): Promise<{ sessionId: string; events: SessionEventRecord[]; limit: number }> {
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 1000);
  const result = await pool.query(
    `select *
     from agent.agent_events
     where session_id = $1
     order by seq asc
     limit $2`,
    [sessionId, limit]
  );

  return {
    sessionId,
    events: result.rows.map(toSessionEventRecord),
    limit
  };
}

export async function getSessionEventsAfter(
  sessionId: string,
  input: { afterSeq?: number; limit?: number } = {}
): Promise<{
  sessionId: string;
  afterSeq: number;
  limit: number;
  events: SessionEventRecord[];
} | null> {
  const session = await pool.query(`select 1 from agent.jobs where session_id = $1 limit 1`, [
    sessionId
  ]);
  if (!session.rows[0]) {
    return null;
  }

  const afterSeq = Math.max(input.afterSeq ?? 0, 0);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const result = await pool.query(
    `select *
     from agent.agent_events
     where session_id = $1 and seq > $2
     order by seq asc
     limit $3`,
    [sessionId, afterSeq, limit]
  );

  return {
    sessionId,
    afterSeq,
    limit,
    events: result.rows.map(toSessionEventRecord)
  };
}

export async function compressSession(
  sessionId: string,
  input: { maxEvents?: number; reason?: string } = {}
): Promise<SessionCompressionResponse | null> {
  const limit = Math.min(Math.max(input.maxEvents ?? 80, 10), 300);
  const jobResult = await pool.query(`select * from agent.jobs where session_id = $1`, [sessionId]);
  const job = jobResult.rows[0];
  if (!job) {
    return null;
  }

  const [events, modelCalls, groupMessages, artifacts] = await Promise.all([
    pool.query(
      `select seq, actor, event_type, payload, created_at
       from agent.agent_events
       where session_id = $1
       order by seq desc
       limit $2`,
      [sessionId, limit]
    ),
    pool.query(
      `select agent_id, action_type, status, error, created_at, updated_at
       from agent.model_calls
       where job_id = $1
       order by created_at desc
       limit 50`,
      [job.id]
    ),
    pool.query(
      `select sender_agent_id, mention_agent_id, message_type, content, created_at
       from agent.group_messages
       where job_id = $1
       order by created_at desc
       limit 50`,
      [job.id]
    ),
    pool.query(
      `select id, type, title, uri, created_at
       from agent.artifacts
       where job_id = $1
       order by created_at desc
       limit 50`,
      [job.id]
    )
  ]);

  const orderedEvents = [...events.rows].reverse();
  const eventLines = orderedEvents.map((event) => {
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    const payloadTitle =
      typeof payload.title === "string"
        ? ` - ${payload.title}`
        : typeof payload.reason === "string"
          ? ` - ${payload.reason}`
          : "";
    return `- #${event.seq} ${event.actor} ${event.event_type}${payloadTitle}`;
  });
  const failedCalls = modelCalls.rows.filter((call) => call.status === "failed" || call.status === "failed_unknown_outcome");
  const artifactLines = artifacts.rows.slice(0, 12).map((artifact) =>
    `- ${artifact.type}: ${artifact.title || artifact.id}${artifact.uri ? ` (${artifact.uri})` : ""}`
  );
  const messageLines = groupMessages.rows.slice(0, 12).map((message) =>
    `- ${message.sender_agent_id} -> ${message.mention_agent_id || "all"} [${message.message_type}]: ${String(message.content).slice(0, 160)}`
  );

  const summary = [
    `# Session summary: ${sessionId}`,
    "",
    `Job: ${job.id}`,
    `Status: ${job.status}`,
    `Routing mode: ${job.routing_mode}`,
    `Workdir: ${job.workdir || "none"}`,
    `Reason: ${input.reason || "manual compression"}`,
    "",
    "Original prompt:",
    job.raw_prompt,
    "",
    "Counts:",
    `- Events included: ${orderedEvents.length}`,
    `- Model calls: ${modelCalls.rows.length}`,
    `- Group messages: ${groupMessages.rows.length}`,
    `- Artifacts: ${artifacts.rows.length}`,
    "",
    "Recent event trail:",
    eventLines.length ? eventLines.join("\n") : "- No events recorded.",
    "",
    "Recent group messages:",
    messageLines.length ? messageLines.join("\n") : "- No group messages recorded.",
    "",
    "Recent artifacts:",
    artifactLines.length ? artifactLines.join("\n") : "- No artifacts recorded.",
    "",
    "Recent model-call failures:",
    failedCalls.length
      ? failedCalls
          .slice(0, 12)
          .map((call) => `- ${call.agent_id} ${call.action_type}: ${call.status}${call.error ? ` - ${call.error}` : ""}`)
          .join("\n")
      : "- No recent model-call failures."
  ].join("\n");

  const artifact = await createArtifact({
    id: `${job.id}-ART-SESSION-SUMMARY`,
    jobId: job.id,
    type: "session_summary",
    title: `Session summary ${sessionId}`,
    content: summary,
    metadata: {
      sessionId,
      reason: input.reason ?? null,
      maxEvents: limit,
      compressedAt: new Date().toISOString()
    }
  });

  return {
    sessionId,
    jobId: job.id,
    artifactId: artifact.id,
    summary,
    counts: {
      events: orderedEvents.length,
      modelCalls: modelCalls.rows.length,
      groupMessages: groupMessages.rows.length,
      artifacts: artifacts.rows.length
    }
  };
}
