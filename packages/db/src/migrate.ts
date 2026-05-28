import { closePool, pool } from "./pool";

const statements = [
  `create schema if not exists agent`,
  `create table if not exists agent.jobs (
    id text primary key,
    feishu_chat_id text,
    feishu_message_id text,
    requester_id text,
    raw_prompt text not null,
    status text not null,
    workflow_id text,
    final_output text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `alter table agent.jobs add column if not exists workdir text`,
  `alter table agent.jobs add column if not exists session_id text`,
  `alter table agent.jobs add column if not exists ingress_origin text not null default 'http'`,
  `alter table agent.jobs add column if not exists routing_mode text not null default 'supervisor_pipeline'`,
  `alter table agent.jobs add column if not exists max_model_calls int not null default 20`,
  `alter table agent.jobs add column if not exists classic_final_gate_enabled boolean not null default false`,
  `alter table agent.jobs add column if not exists discussion_rounds int not null default 2`,
  `alter table agent.jobs add column if not exists completed_at timestamptz`,
  `alter table agent.jobs add column if not exists archived_at timestamptz`,
  `alter table agent.jobs add column if not exists retention_until timestamptz`,
  `alter table agent.jobs add column if not exists cleanup_status text not null default 'active'`,
  `alter table agent.jobs add column if not exists retention_policy jsonb not null default '{}'`,
  `update agent.jobs set session_id = id where session_id is null`,
  `create unique index if not exists jobs_session_id_idx
    on agent.jobs(session_id)
    where session_id is not null`,
  `create unique index if not exists jobs_feishu_message_id_idx
    on agent.jobs(feishu_message_id)
    where feishu_message_id is not null`,
  `create table if not exists agent.job_events (
    id bigserial primary key,
    job_id text not null references agent.jobs(id),
    event_type text not null,
    payload jsonb not null default '{}',
    created_at timestamptz not null default now()
  )`,
  `create table if not exists agent.agent_events (
    id bigserial primary key,
    session_id text not null,
    job_id text not null references agent.jobs(id),
    stage_id text,
    seq int not null,
    actor text not null,
    event_type text not null,
    payload jsonb not null default '{}',
    artifact_id text,
    group_message_id text,
    feishu_message_id text,
    created_at timestamptz not null default now(),
    unique(session_id, seq)
  )`,
  `create table if not exists agent.artifacts (
    id text primary key,
    job_id text not null references agent.jobs(id),
    stage_id text,
    type text not null,
    title text,
    content text,
    uri text,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now()
  )`,
  `create table if not exists agent.job_stages (
    id text primary key,
    job_id text not null references agent.jobs(id),
    stage_index int not null,
    stage_type text not null,
    agent_id text not null,
    name text not null,
    status text not null,
    input_artifact_id text references agent.artifacts(id),
    output_artifact_id text references agent.artifacts(id),
    acceptance_criteria jsonb not null default '[]',
    retry_count int not null default 0,
    max_retries int not null default 3,
    original_agent_session_id text,
    original_test_session_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(job_id, stage_index)
  )`,
  `create table if not exists agent.stage_attempts (
    id text primary key,
    stage_id text not null references agent.job_stages(id),
    attempt_no int not null,
    agent_id text not null,
    agent_session_id text,
    input_artifact_id text references agent.artifacts(id),
    output_artifact_id text references agent.artifacts(id),
    status text not null,
    error text,
    started_at timestamptz,
    finished_at timestamptz,
    unique(stage_id, attempt_no)
  )`,
  `create table if not exists agent.test_reviews (
    id text primary key,
    stage_id text not null references agent.job_stages(id),
    attempt_id text references agent.stage_attempts(id),
    test_agent_id text not null,
    test_agent_session_id text,
    verdict text not null,
    issue_count int not null default 0,
    report_artifact_id text references agent.artifacts(id),
    required_fixes jsonb not null default '[]',
    created_at timestamptz not null default now()
  )`,
  `create table if not exists agent.group_messages (
    id text primary key,
    job_id text not null references agent.jobs(id),
    stage_id text references agent.job_stages(id),
    sender_agent_id text not null,
    mention_agent_id text,
    message_type text not null,
    content text not null,
    artifact_id text references agent.artifacts(id),
    feishu_message_id text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists agent.model_calls (
    id text primary key,
    idempotency_key text not null unique,
    job_id text not null references agent.jobs(id),
    stage_id text references agent.job_stages(id),
    attempt_no int not null,
    action_type text not null,
    agent_id text not null,
    agent_session_id text,
    request_hash text,
    status text not null,
    response_payload jsonb,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `alter table agent.artifacts
    drop constraint if exists artifacts_stage_id_fkey`,
  `alter table agent.artifacts
    add constraint artifacts_stage_id_fkey
    foreign key (stage_id) references agent.job_stages(id)`,
  `create index if not exists job_events_job_id_created_at_idx
    on agent.job_events(job_id, created_at)`,
  `create index if not exists agent_events_session_seq_idx
    on agent.agent_events(session_id, seq)`,
  `create index if not exists agent_events_job_id_created_at_idx
    on agent.agent_events(job_id, created_at)`,
  `create index if not exists agent_events_stage_id_seq_idx
    on agent.agent_events(stage_id, seq)`,
  `create index if not exists jobs_status_created_at_idx
    on agent.jobs(status, created_at)`,
  `create index if not exists jobs_ingress_origin_created_at_idx
    on agent.jobs(ingress_origin, created_at)`,
  `create index if not exists jobs_retention_until_cleanup_status_idx
    on agent.jobs(retention_until, cleanup_status)
    where archived_at is not null`,
  `create index if not exists artifacts_job_id_created_at_idx
    on agent.artifacts(job_id, created_at)`,
  `create index if not exists job_stages_job_id_stage_index_idx
    on agent.job_stages(job_id, stage_index)`,
  `create index if not exists stage_attempts_stage_id_attempt_no_idx
    on agent.stage_attempts(stage_id, attempt_no)`,
  `create index if not exists test_reviews_stage_id_created_at_idx
    on agent.test_reviews(stage_id, created_at)`,
  `create index if not exists group_messages_job_id_created_at_idx
    on agent.group_messages(job_id, created_at)`,
  `create index if not exists group_messages_stage_id_created_at_idx
    on agent.group_messages(stage_id, created_at)`,
  `create index if not exists model_calls_job_id_created_at_idx
    on agent.model_calls(job_id, created_at)`,
  `create index if not exists model_calls_stage_attempt_idx
    on agent.model_calls(stage_id, attempt_no, action_type)`
];

async function main() {
  for (const statement of statements) {
    await pool.query(statement);
  }

  console.log("Database migration complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
