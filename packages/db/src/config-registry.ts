import { randomUUID } from "node:crypto";
import {
  AGENT_SYNC_STATUSES,
  PROVIDER_VERIFICATION_STATUSES,
  type AgentConfigRecord,
  type AgentSyncStatus,
  type ModelProviderRecord,
  type ProviderVerificationStatus
} from "../../shared/src/types";
import { pool } from "./pool";

function normalizeProviderVerificationStatus(value: unknown): ProviderVerificationStatus {
  return typeof value === "string" &&
    (PROVIDER_VERIFICATION_STATUSES as readonly string[]).includes(value)
    ? (value as ProviderVerificationStatus)
    : "unknown";
}

function normalizeAgentSyncStatus(value: unknown): AgentSyncStatus {
  return typeof value === "string" && (AGENT_SYNC_STATUSES as readonly string[]).includes(value)
    ? (value as AgentSyncStatus)
    : "pending";
}

function normalizeTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toModelProviderRecord(row: any): ModelProviderRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    apiKeyConfigured: row.api_key_configured ?? false,
    apiKeyFingerprint: row.api_key_fingerprint,
    verificationStatus: normalizeProviderVerificationStatus(row.verification_status),
    lastVerifiedAt: row.last_verified_at ? row.last_verified_at.toISOString() : null,
    lastError: row.last_error,
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toAgentConfigRecord(row: any): AgentConfigRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    agentRole: row.agent_role,
    required: row.required ?? true,
    enabled: row.enabled ?? true,
    providerId: row.provider_id,
    model: row.model,
    apiKeyConfigured: row.api_key_configured ?? false,
    apiKeyFingerprint: row.api_key_fingerprint,
    workspacePath: row.workspace_path,
    promptTemplatePath: row.prompt_template_path,
    tools: normalizeTools(row.tools),
    openclawSyncStatus: normalizeAgentSyncStatus(row.openclaw_sync_status),
    openclawAgentPath: row.openclaw_agent_path,
    lastSyncedAt: row.last_synced_at ? row.last_synced_at.toISOString() : null,
    lastError: row.last_error,
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function fallbackId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function listModelProviders(): Promise<ModelProviderRecord[]> {
  const result = await pool.query(
    `select *
     from agent.model_providers
     order by updated_at desc, id asc`
  );
  return result.rows.map(toModelProviderRecord);
}

export async function getModelProvider(providerId: string): Promise<ModelProviderRecord | null> {
  const result = await pool.query(`select * from agent.model_providers where id = $1`, [
    providerId
  ]);
  return result.rows[0] ? toModelProviderRecord(result.rows[0]) : null;
}

export async function upsertModelProvider(input: {
  id?: string;
  displayName: string;
  baseUrl: string;
  defaultModel?: string | null;
  apiKeyConfigured?: boolean;
  apiKeyFingerprint?: string | null;
  verificationStatus?: ProviderVerificationStatus;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ModelProviderRecord> {
  const id = input.id?.trim() || fallbackId("provider");
  const result = await pool.query(
    `insert into agent.model_providers (
      id,
      display_name,
      base_url,
      default_model,
      api_key_configured,
      api_key_fingerprint,
      verification_status,
      last_verified_at,
      last_error,
      metadata
    ) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb)
    on conflict (id) do update set
      display_name = excluded.display_name,
      base_url = excluded.base_url,
      default_model = excluded.default_model,
      api_key_configured = excluded.api_key_configured,
      api_key_fingerprint = excluded.api_key_fingerprint,
      verification_status = excluded.verification_status,
      last_verified_at = excluded.last_verified_at,
      last_error = excluded.last_error,
      metadata = excluded.metadata,
      updated_at = now()
    returning *`,
    [
      id,
      input.displayName,
      input.baseUrl,
      input.defaultModel ?? null,
      input.apiKeyConfigured ?? false,
      input.apiKeyFingerprint ?? null,
      input.verificationStatus ?? "unknown",
      input.lastVerifiedAt ?? null,
      input.lastError ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return toModelProviderRecord(result.rows[0]);
}

export async function patchModelProvider(
  providerId: string,
  input: Partial<{
    displayName: string;
    baseUrl: string;
    defaultModel: string | null;
    apiKeyConfigured: boolean;
    apiKeyFingerprint: string | null;
    verificationStatus: ProviderVerificationStatus;
    lastVerifiedAt: string | null;
    lastError: string | null;
    metadata: Record<string, unknown>;
  }>
): Promise<ModelProviderRecord | null> {
  const current = await getModelProvider(providerId);
  if (!current) {
    return null;
  }
  return upsertModelProvider({
    id: providerId,
    displayName: input.displayName ?? current.displayName,
    baseUrl: input.baseUrl ?? current.baseUrl,
    defaultModel: input.defaultModel !== undefined ? input.defaultModel : current.defaultModel,
    apiKeyConfigured: input.apiKeyConfigured ?? current.apiKeyConfigured,
    apiKeyFingerprint:
      input.apiKeyFingerprint !== undefined ? input.apiKeyFingerprint : current.apiKeyFingerprint,
    verificationStatus: input.verificationStatus ?? current.verificationStatus,
    lastVerifiedAt: input.lastVerifiedAt !== undefined ? input.lastVerifiedAt : current.lastVerifiedAt,
    lastError: input.lastError !== undefined ? input.lastError : current.lastError,
    metadata: input.metadata ?? current.metadata
  });
}

export async function listAgentConfigs(): Promise<AgentConfigRecord[]> {
  const result = await pool.query(
    `select *
     from agent.agent_configs
     order by required desc, agent_role asc, id asc`
  );
  return result.rows.map(toAgentConfigRecord);
}

export async function getAgentConfig(agentId: string): Promise<AgentConfigRecord | null> {
  const result = await pool.query(`select * from agent.agent_configs where id = $1`, [agentId]);
  return result.rows[0] ? toAgentConfigRecord(result.rows[0]) : null;
}

export async function upsertAgentConfig(input: {
  id: string;
  displayName: string;
  agentRole: string;
  required?: boolean;
  enabled?: boolean;
  providerId?: string | null;
  model?: string | null;
  apiKeyConfigured?: boolean;
  apiKeyFingerprint?: string | null;
  workspacePath?: string | null;
  promptTemplatePath?: string | null;
  tools?: string[];
  openclawSyncStatus?: AgentSyncStatus;
  openclawAgentPath?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AgentConfigRecord> {
  const result = await pool.query(
    `insert into agent.agent_configs (
      id,
      display_name,
      agent_role,
      required,
      enabled,
      provider_id,
      model,
      api_key_configured,
      api_key_fingerprint,
      workspace_path,
      prompt_template_path,
      tools,
      openclaw_sync_status,
      openclaw_agent_path,
      last_synced_at,
      last_error,
      metadata
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15::timestamptz, $16, $17::jsonb)
    on conflict (id) do update set
      display_name = excluded.display_name,
      agent_role = excluded.agent_role,
      required = excluded.required,
      enabled = excluded.enabled,
      provider_id = excluded.provider_id,
      model = excluded.model,
      api_key_configured = excluded.api_key_configured,
      api_key_fingerprint = excluded.api_key_fingerprint,
      workspace_path = excluded.workspace_path,
      prompt_template_path = excluded.prompt_template_path,
      tools = excluded.tools,
      openclaw_sync_status = excluded.openclaw_sync_status,
      openclaw_agent_path = excluded.openclaw_agent_path,
      last_synced_at = excluded.last_synced_at,
      last_error = excluded.last_error,
      metadata = excluded.metadata,
      updated_at = now()
    returning *`,
    [
      input.id,
      input.displayName,
      input.agentRole,
      input.required ?? true,
      input.enabled ?? true,
      input.providerId ?? null,
      input.model ?? null,
      input.apiKeyConfigured ?? false,
      input.apiKeyFingerprint ?? null,
      input.workspacePath ?? null,
      input.promptTemplatePath ?? null,
      JSON.stringify(input.tools ?? []),
      input.openclawSyncStatus ?? "pending",
      input.openclawAgentPath ?? null,
      input.lastSyncedAt ?? null,
      input.lastError ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return toAgentConfigRecord(result.rows[0]);
}

export async function patchAgentConfig(
  agentId: string,
  input: Partial<{
    displayName: string;
    agentRole: string;
    required: boolean;
    enabled: boolean;
    providerId: string | null;
    model: string | null;
    apiKeyConfigured: boolean;
    apiKeyFingerprint: string | null;
    workspacePath: string | null;
    promptTemplatePath: string | null;
    tools: string[];
    openclawSyncStatus: AgentSyncStatus;
    openclawAgentPath: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
    metadata: Record<string, unknown>;
  }>
): Promise<AgentConfigRecord | null> {
  const current = await getAgentConfig(agentId);
  if (!current) {
    return null;
  }
  return upsertAgentConfig({
    id: agentId,
    displayName: input.displayName ?? current.displayName,
    agentRole: input.agentRole ?? current.agentRole,
    required: input.required ?? current.required,
    enabled: input.enabled ?? current.enabled,
    providerId: input.providerId !== undefined ? input.providerId : current.providerId,
    model: input.model !== undefined ? input.model : current.model,
    apiKeyConfigured: input.apiKeyConfigured ?? current.apiKeyConfigured,
    apiKeyFingerprint:
      input.apiKeyFingerprint !== undefined ? input.apiKeyFingerprint : current.apiKeyFingerprint,
    workspacePath: input.workspacePath !== undefined ? input.workspacePath : current.workspacePath,
    promptTemplatePath:
      input.promptTemplatePath !== undefined ? input.promptTemplatePath : current.promptTemplatePath,
    tools: input.tools ?? current.tools,
    openclawSyncStatus: input.openclawSyncStatus ?? current.openclawSyncStatus,
    openclawAgentPath:
      input.openclawAgentPath !== undefined ? input.openclawAgentPath : current.openclawAgentPath,
    lastSyncedAt: input.lastSyncedAt !== undefined ? input.lastSyncedAt : current.lastSyncedAt,
    lastError: input.lastError !== undefined ? input.lastError : current.lastError,
    metadata: input.metadata ?? current.metadata
  });
}

export const defaultAgentCatalog: Array<{
  id: string;
  displayName: string;
  agentRole: string;
  tools: string[];
  metadata: Record<string, unknown>;
}> = [
  {
    id: "panel-agent",
    displayName: "Panel Agent",
    agentRole: "panel_supervisor",
    tools: ["planning", "routing", "approval_requests", "final_synthesis"],
    metadata: { openclawAgentId: "main-agent", isMainAgent: true }
  },
  {
    id: "research-agent",
    displayName: "Research Agent",
    agentRole: "research",
    tools: ["web_research", "source_notes", "fact_checking"],
    metadata: { openclawAgentId: "research-agent" }
  },
  {
    id: "writer-agent",
    displayName: "Writer Agent",
    agentRole: "writing",
    tools: ["drafting", "rewriting", "formatting"],
    metadata: { openclawAgentId: "writer-agent" }
  },
  {
    id: "image-agent",
    displayName: "Image Agent",
    agentRole: "image",
    tools: ["image_brief", "image_prompt", "image_generation"],
    metadata: { openclawAgentId: "image-agent" }
  },
  {
    id: "video-agent",
    displayName: "Video Agent",
    agentRole: "video",
    tools: ["video_brief", "storyboard", "video_generation"],
    metadata: { openclawAgentId: "video-agent" }
  },
  {
    id: "test-agent",
    displayName: "Test Agent",
    agentRole: "review",
    tools: ["quality_gate", "test_review", "repair_advice"],
    metadata: { openclawAgentId: "test-agent" }
  }
];

export async function seedDefaultAgentConfigs(input: {
  panelAgentName?: string;
  providerId?: string | null;
  model?: string | null;
  apiKeyConfigured?: boolean;
  apiKeyFingerprint?: string | null;
} = {}): Promise<AgentConfigRecord[]> {
  const records: AgentConfigRecord[] = [];
  for (const agent of defaultAgentCatalog) {
    const isPanel = agent.id === "panel-agent";
    const existing = await getAgentConfig(agent.id);
    records.push(
      await upsertAgentConfig({
        ...agent,
        displayName: isPanel
          ? input.panelAgentName?.trim() || existing?.displayName || agent.displayName
          : existing?.displayName || agent.displayName,
        providerId: isPanel
          ? input.providerId !== undefined
            ? input.providerId
            : existing?.providerId ?? null
          : existing?.providerId ?? null,
        model: isPanel
          ? input.model !== undefined
            ? input.model
            : existing?.model ?? null
          : existing?.model ?? null,
        apiKeyConfigured:
          isPanel && input.apiKeyConfigured !== undefined
            ? input.apiKeyConfigured
            : existing?.apiKeyConfigured ?? false,
        apiKeyFingerprint:
          isPanel && input.apiKeyFingerprint !== undefined
            ? input.apiKeyFingerprint
            : existing?.apiKeyFingerprint ?? null,
        required: true,
        enabled: existing?.enabled ?? true,
        workspacePath: existing?.workspacePath ?? null,
        promptTemplatePath: existing?.promptTemplatePath ?? null,
        openclawSyncStatus: existing?.openclawSyncStatus ?? "pending",
        openclawAgentPath: existing?.openclawAgentPath ?? null,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        lastError: existing?.lastError ?? null,
        metadata: { ...agent.metadata, ...(existing?.metadata ?? {}) }
      })
    );
  }
  return records;
}
