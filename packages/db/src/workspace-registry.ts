import { randomUUID } from "node:crypto";
import type { WorkspaceRegistrationRecord } from "../../shared/src/types";
import { pool } from "./pool";

function toWorkspaceRegistrationRecord(row: any): WorkspaceRegistrationRecord {
  return {
    id: row.id,
    rootPath: row.root_path,
    rootPathKey: row.root_path_key,
    displayName: row.display_name,
    enabled: row.enabled ?? true,
    approvalId: row.approval_id,
    registeredBy: row.registered_by,
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null
  };
}

function fallbackWorkspaceId() {
  return `workspace-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function listRegisteredWorkspaces(input: { enabled?: boolean } = {}) {
  const values: unknown[] = [];
  const where: string[] = [];

  if (input.enabled !== undefined) {
    values.push(input.enabled);
    where.push(`enabled = $${values.length}`);
  }

  const result = await pool.query(
    `select *
     from agent.registered_workspaces
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by updated_at desc, root_path asc`,
    values
  );
  return result.rows.map(toWorkspaceRegistrationRecord);
}

export async function getRegisteredWorkspaceByRootKey(rootPathKey: string) {
  const result = await pool.query(
    `select * from agent.registered_workspaces where root_path_key = $1`,
    [rootPathKey]
  );
  return result.rows[0] ? toWorkspaceRegistrationRecord(result.rows[0]) : null;
}

export async function upsertRegisteredWorkspace(input: {
  id?: string;
  rootPath: string;
  rootPathKey: string;
  displayName?: string | null;
  approvalId?: string | null;
  registeredBy?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const id = input.id?.trim() || fallbackWorkspaceId();
  const result = await pool.query(
    `insert into agent.registered_workspaces (
      id,
      root_path,
      root_path_key,
      display_name,
      enabled,
      approval_id,
      registered_by,
      metadata,
      last_used_at
    ) values ($1, $2, $3, $4, true, $5, $6, $7::jsonb, now())
    on conflict (root_path_key) do update set
      root_path = excluded.root_path,
      display_name = excluded.display_name,
      enabled = true,
      approval_id = excluded.approval_id,
      registered_by = excluded.registered_by,
      metadata = excluded.metadata,
      updated_at = now(),
      last_used_at = now()
    returning *`,
    [
      id,
      input.rootPath,
      input.rootPathKey,
      input.displayName ?? null,
      input.approvalId ?? null,
      input.registeredBy ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return toWorkspaceRegistrationRecord(result.rows[0]);
}

export async function markRegisteredWorkspaceUsed(rootPathKey: string) {
  const result = await pool.query(
    `update agent.registered_workspaces
     set last_used_at = now(),
         updated_at = now()
     where root_path_key = $1
       and enabled = true
     returning *`,
    [rootPathKey]
  );
  return result.rows[0] ? toWorkspaceRegistrationRecord(result.rows[0]) : null;
}
