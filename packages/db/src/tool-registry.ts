import { randomUUID } from "node:crypto";
import {
  MCP_SERVER_STATUSES,
  type McpServerRecord,
  type McpServerStatus,
  type SkillRegistryRecord
} from "../../shared/src/types";
import { pool } from "./pool";

function fallbackId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeMcpStatus(value: unknown): McpServerStatus {
  return typeof value === "string" && (MCP_SERVER_STATUSES as readonly string[]).includes(value)
    ? (value as McpServerStatus)
    : "unknown";
}

function toSkillRecord(row: any): SkillRegistryRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled ?? true,
    source: row.source,
    config: row.config ?? {},
    diagnostics: row.diagnostics ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toMcpServerRecord(row: any): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: normalizeStringArray(row.args),
    envKeys: normalizeStringArray(row.env_keys),
    enabled: row.enabled ?? true,
    status: normalizeMcpStatus(row.status),
    lastCheckedAt: row.last_checked_at ? row.last_checked_at.toISOString() : null,
    lastError: row.last_error,
    config: row.config ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function listSkills(): Promise<SkillRegistryRecord[]> {
  const result = await pool.query(
    `select * from agent.skill_registry order by enabled desc, updated_at desc, id asc`
  );
  return result.rows.map(toSkillRecord);
}

export async function getSkill(skillId: string): Promise<SkillRegistryRecord | null> {
  const result = await pool.query(`select * from agent.skill_registry where id = $1`, [skillId]);
  return result.rows[0] ? toSkillRecord(result.rows[0]) : null;
}

export async function upsertSkill(input: {
  id?: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  source?: string;
  config?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}): Promise<SkillRegistryRecord> {
  const id = input.id?.trim() || fallbackId("skill");
  const result = await pool.query(
    `insert into agent.skill_registry (
      id, name, description, enabled, source, config, diagnostics
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
    on conflict (id) do update set
      name = excluded.name,
      description = excluded.description,
      enabled = excluded.enabled,
      source = excluded.source,
      config = excluded.config,
      diagnostics = excluded.diagnostics,
      updated_at = now()
    returning *`,
    [
      id,
      input.name,
      input.description ?? null,
      input.enabled ?? true,
      input.source ?? "user",
      JSON.stringify(input.config ?? {}),
      JSON.stringify(input.diagnostics ?? {})
    ]
  );
  return toSkillRecord(result.rows[0]);
}

export async function patchSkill(
  skillId: string,
  input: Partial<{
    name: string;
    description: string | null;
    enabled: boolean;
    source: string;
    config: Record<string, unknown>;
    diagnostics: Record<string, unknown>;
  }>
): Promise<SkillRegistryRecord | null> {
  const current = await getSkill(skillId);
  if (!current) {
    return null;
  }
  return upsertSkill({
    id: skillId,
    name: input.name ?? current.name,
    description: input.description !== undefined ? input.description : current.description,
    enabled: input.enabled ?? current.enabled,
    source: input.source ?? current.source,
    config: input.config ?? current.config,
    diagnostics: input.diagnostics ?? current.diagnostics
  });
}

export async function listMcpServers(): Promise<McpServerRecord[]> {
  const result = await pool.query(
    `select * from agent.mcp_servers order by enabled desc, updated_at desc, id asc`
  );
  return result.rows.map(toMcpServerRecord);
}

export async function getMcpServer(serverId: string): Promise<McpServerRecord | null> {
  const result = await pool.query(`select * from agent.mcp_servers where id = $1`, [serverId]);
  return result.rows[0] ? toMcpServerRecord(result.rows[0]) : null;
}

export async function upsertMcpServer(input: {
  id?: string;
  name: string;
  command: string;
  args?: string[];
  envKeys?: string[];
  enabled?: boolean;
  status?: McpServerStatus;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  config?: Record<string, unknown>;
}): Promise<McpServerRecord> {
  const id = input.id?.trim() || fallbackId("mcp");
  const result = await pool.query(
    `insert into agent.mcp_servers (
      id, name, command, args, env_keys, enabled, status, last_checked_at, last_error, config
    ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::timestamptz, $9, $10::jsonb)
    on conflict (id) do update set
      name = excluded.name,
      command = excluded.command,
      args = excluded.args,
      env_keys = excluded.env_keys,
      enabled = excluded.enabled,
      status = excluded.status,
      last_checked_at = excluded.last_checked_at,
      last_error = excluded.last_error,
      config = excluded.config,
      updated_at = now()
    returning *`,
    [
      id,
      input.name,
      input.command,
      JSON.stringify(input.args ?? []),
      JSON.stringify(input.envKeys ?? []),
      input.enabled ?? true,
      input.status ?? "unknown",
      input.lastCheckedAt ?? null,
      input.lastError ?? null,
      JSON.stringify(input.config ?? {})
    ]
  );
  return toMcpServerRecord(result.rows[0]);
}

export async function patchMcpServer(
  serverId: string,
  input: Partial<{
    name: string;
    command: string;
    args: string[];
    envKeys: string[];
    enabled: boolean;
    status: McpServerStatus;
    lastCheckedAt: string | null;
    lastError: string | null;
    config: Record<string, unknown>;
  }>
): Promise<McpServerRecord | null> {
  const current = await getMcpServer(serverId);
  if (!current) {
    return null;
  }
  return upsertMcpServer({
    id: serverId,
    name: input.name ?? current.name,
    command: input.command ?? current.command,
    args: input.args ?? current.args,
    envKeys: input.envKeys ?? current.envKeys,
    enabled: input.enabled ?? current.enabled,
    status: input.status ?? current.status,
    lastCheckedAt: input.lastCheckedAt !== undefined ? input.lastCheckedAt : current.lastCheckedAt,
    lastError: input.lastError !== undefined ? input.lastError : current.lastError,
    config: input.config ?? current.config
  });
}
