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
  `create table if not exists agent.experience_candidates (
    id text primary key,
    source_job_id text not null references agent.jobs(id),
    kind text not null,
    scope text not null,
    scope_key text not null default '',
    status text not null default 'candidate',
    summary text not null,
    evidence jsonb not null default '[]',
    confidence numeric(4, 3) not null,
    occurrence_count int not null default 1,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    adopted_at timestamptz,
    rejected_at timestamptz,
    unique(source_job_id, kind, scope, scope_key)
  )`,
  `create table if not exists agent.task_plans (
    id text primary key,
    job_id text not null references agent.jobs(id),
    title text not null,
    summary text,
    status text not null default 'active',
    source text not null default 'manual',
    source_artifact_id text references agent.artifacts(id),
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists agent.task_plan_items (
    id text primary key,
    plan_id text not null references agent.task_plans(id) on delete cascade,
    position int not null,
    title text not null,
    body text,
    status text not null default 'pending',
    agent_id text,
    stage_id text references agent.job_stages(id),
    artifact_id text references agent.artifacts(id),
    acceptance_criteria jsonb not null default '[]',
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    unique(plan_id, position)
  )`,
  `create table if not exists agent.tool_approval_requests (
    id text primary key,
    job_id text not null references agent.jobs(id),
    session_id text not null,
    stage_id text references agent.job_stages(id),
    agent_id text not null,
    requester_actor text not null default 'tool-gateway',
    tool_name text not null,
    action_type text not null,
    risk_level text not null default 'medium',
    reason text,
    command text,
    target text,
    input jsonb not null default '{}',
    policy jsonb not null default '{}',
    status text not null default 'pending',
    decision_reason text,
    decided_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    expires_at timestamptz,
    decided_at timestamptz,
    consumed_at timestamptz
  )`,
  `create table if not exists agent.model_providers (
    id text primary key,
    display_name text not null,
    base_url text not null,
    default_model text,
    api_key_configured boolean not null default false,
    api_key_fingerprint text,
    verification_status text not null default 'unknown',
    last_verified_at timestamptz,
    last_error text,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists agent.agent_configs (
    id text primary key,
    display_name text not null,
    agent_role text not null,
    required boolean not null default true,
    enabled boolean not null default true,
    provider_id text references agent.model_providers(id),
    model text,
    api_key_configured boolean not null default false,
    api_key_fingerprint text,
    workspace_path text,
    prompt_template_path text,
    tools jsonb not null default '[]',
    openclaw_sync_status text not null default 'pending',
    openclaw_agent_path text,
    last_synced_at timestamptz,
    last_error text,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists agent.skill_registry (
    id text primary key,
    name text not null,
    description text,
    enabled boolean not null default true,
    source text not null default 'user',
    config jsonb not null default '{}',
    diagnostics jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists agent.mcp_servers (
    id text primary key,
    name text not null,
    command text not null,
    args jsonb not null default '[]',
    env_keys jsonb not null default '[]',
    enabled boolean not null default true,
    status text not null default 'unknown',
    last_checked_at timestamptz,
    last_error text,
    config jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists agent.agent_mcp_policies (
    id text primary key,
    agent_config_id text not null references agent.agent_configs(id) on delete cascade,
    mcp_server_id text not null references agent.mcp_servers(id) on delete cascade,
    enabled boolean not null default true,
    allow_tools_list boolean not null default true,
    allow_resources_list boolean not null default false,
    allow_all_tools boolean not null default false,
    allowed_tools jsonb not null default '[]',
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(agent_config_id, mcp_server_id)
  )`,
  `create table if not exists agent.registered_workspaces (
    id text primary key,
    root_path text not null,
    root_path_key text not null unique,
    display_name text,
    enabled boolean not null default true,
    approval_id text references agent.tool_approval_requests(id),
    registered_by text,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_used_at timestamptz
  )`,
  `create table if not exists agent.scheduled_tasks (
    id text primary key,
    title text not null,
    raw_prompt text not null,
    schedule_type text not null default 'manual',
    enabled boolean not null default true,
    workspace_path text,
    routing_mode text not null default 'supervisor_pipeline',
    max_model_calls int not null default 20,
    provider_id text references agent.model_providers(id),
    agent_config_id text references agent.agent_configs(id),
    run_at timestamptz,
    interval_seconds int,
    next_run_at timestamptz,
    last_run_at timestamptz,
    status text not null default 'idle',
    last_job_id text references agent.jobs(id),
    last_error text,
    metadata jsonb not null default '{}',
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
  `create index if not exists jobs_created_at_id_idx
    on agent.jobs(created_at, id)`,
  `create index if not exists jobs_updated_at_id_idx
    on agent.jobs(updated_at, id)`,
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
    on agent.model_calls(stage_id, attempt_no, action_type)`,
  `create index if not exists experience_candidates_status_updated_at_idx
    on agent.experience_candidates(status, updated_at desc)`,
  `create index if not exists experience_candidates_scope_idx
    on agent.experience_candidates(scope, scope_key, status)`,
  `create index if not exists task_plans_job_id_updated_at_idx
    on agent.task_plans(job_id, updated_at desc)`,
  `create index if not exists task_plans_status_updated_at_idx
    on agent.task_plans(status, updated_at desc)`,
  `create index if not exists task_plan_items_plan_position_idx
    on agent.task_plan_items(plan_id, position)`,
  `create index if not exists task_plan_items_status_idx
    on agent.task_plan_items(status, updated_at desc)`,
  `create index if not exists tool_approval_requests_status_updated_at_idx
    on agent.tool_approval_requests(status, updated_at desc)`,
  `create index if not exists tool_approval_requests_job_created_at_idx
    on agent.tool_approval_requests(job_id, created_at desc)`,
  `create index if not exists tool_approval_requests_session_created_at_idx
    on agent.tool_approval_requests(session_id, created_at desc)`,
  `create index if not exists tool_approval_requests_stage_created_at_idx
    on agent.tool_approval_requests(stage_id, created_at desc)
    where stage_id is not null`,
  `create index if not exists model_providers_updated_at_idx
    on agent.model_providers(updated_at desc)`,
  `create index if not exists model_providers_verification_status_idx
    on agent.model_providers(verification_status, updated_at desc)`,
  `create index if not exists agent_configs_role_idx
    on agent.agent_configs(agent_role, required, enabled)`,
  `create index if not exists agent_configs_provider_idx
    on agent.agent_configs(provider_id)
    where provider_id is not null`,
  `create index if not exists skill_registry_enabled_idx
    on agent.skill_registry(enabled, updated_at desc)`,
  `create index if not exists mcp_servers_enabled_status_idx
    on agent.mcp_servers(enabled, status, updated_at desc)`,
  `create index if not exists agent_mcp_policies_agent_idx
    on agent.agent_mcp_policies(agent_config_id, enabled, updated_at desc)`,
  `create index if not exists agent_mcp_policies_server_idx
    on agent.agent_mcp_policies(mcp_server_id, enabled, updated_at desc)`,
  `create index if not exists registered_workspaces_enabled_idx
    on agent.registered_workspaces(enabled, updated_at desc)`,
  `create index if not exists scheduled_tasks_enabled_next_run_idx
    on agent.scheduled_tasks(enabled, next_run_at)
    where next_run_at is not null`,
  `create index if not exists scheduled_tasks_status_updated_idx
    on agent.scheduled_tasks(status, updated_at desc)`,
  `create index if not exists scheduled_tasks_provider_idx
    on agent.scheduled_tasks(provider_id)
    where provider_id is not null`,
  `create index if not exists scheduled_tasks_agent_config_idx
    on agent.scheduled_tasks(agent_config_id)
    where agent_config_id is not null`
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
