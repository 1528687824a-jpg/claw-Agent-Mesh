import { randomUUID } from "node:crypto";
import {
  EXPERIENCE_KINDS,
  EXPERIENCE_SCOPES,
  EXPERIENCE_STATUSES,
  type ExperienceKind,
  type ExperienceRecord,
  type ExperienceScope,
  type ExperienceStatus
} from "../../shared/src/types";
import { pool } from "./pool";

function normalizeStatus(value: unknown): ExperienceStatus {
  return typeof value === "string" && (EXPERIENCE_STATUSES as readonly string[]).includes(value)
    ? (value as ExperienceStatus)
    : "candidate";
}

function normalizeKind(value: unknown): ExperienceKind {
  return typeof value === "string" && (EXPERIENCE_KINDS as readonly string[]).includes(value)
    ? (value as ExperienceKind)
    : "routing_outcome";
}

function normalizeScope(value: unknown): ExperienceScope {
  return typeof value === "string" && (EXPERIENCE_SCOPES as readonly string[]).includes(value)
    ? (value as ExperienceScope)
    : "routing_mode";
}

function toExperienceRecord(row: any): ExperienceRecord {
  return {
    id: row.id,
    sourceJobId: row.source_job_id,
    kind: normalizeKind(row.kind),
    scope: normalizeScope(row.scope),
    scopeKey: row.scope_key ?? "",
    status: normalizeStatus(row.status),
    summary: row.summary,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    confidence: Number(row.confidence),
    occurrenceCount: Number(row.occurrence_count ?? 1),
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    adoptedAt: row.adopted_at ? row.adopted_at.toISOString() : null,
    rejectedAt: row.rejected_at ? row.rejected_at.toISOString() : null
  };
}

export async function createExperienceCandidate(input: {
  id?: string;
  sourceJobId: string;
  kind: ExperienceKind;
  scope: ExperienceScope;
  scopeKey: string;
  summary: string;
  evidence: Array<Record<string, unknown>>;
  confidence: number;
  metadata?: Record<string, unknown>;
}) {
  const id = input.id ?? `EXP-${randomUUID().slice(0, 12).toUpperCase()}`;
  const confidence = Math.min(Math.max(input.confidence, 0), 1);
  const result = await pool.query(
    `insert into agent.experience_candidates (
      id,
      source_job_id,
      kind,
      scope,
      scope_key,
      summary,
      evidence,
      confidence,
      metadata
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
    on conflict (source_job_id, kind, scope, scope_key)
    do update set
      summary = excluded.summary,
      evidence = excluded.evidence,
      confidence = excluded.confidence,
      metadata = excluded.metadata,
      updated_at = now()
    returning *`,
    [
      id,
      input.sourceJobId,
      input.kind,
      input.scope,
      input.scopeKey,
      input.summary,
      JSON.stringify(input.evidence),
      confidence,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return toExperienceRecord(result.rows[0]);
}

export async function getExperience(experienceId: string): Promise<ExperienceRecord | null> {
  const result = await pool.query(`select * from agent.experience_candidates where id = $1`, [
    experienceId
  ]);
  return result.rows[0] ? toExperienceRecord(result.rows[0]) : null;
}

export async function listExperiences(input: {
  status?: ExperienceStatus;
  limit?: number;
} = {}) {
  const status = input.status ? normalizeStatus(input.status) : null;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const values: unknown[] = [];
  const where: string[] = [];

  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  values.push(limit);

  const [itemsResult, summaryResult] = await Promise.all([
    pool.query(
      `select *
       from agent.experience_candidates
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc, id desc
       limit $${values.length}`,
      values
    ),
    pool.query(
      `select
        count(*) filter (where status = 'candidate') as candidate,
        count(*) filter (where status = 'adopted') as adopted,
        count(*) filter (where status = 'rejected') as rejected
       from agent.experience_candidates`
    )
  ]);
  const counts = summaryResult.rows[0];

  return {
    experiences: itemsResult.rows.map(toExperienceRecord),
    summary: {
      candidate: Number(counts.candidate ?? 0),
      adopted: Number(counts.adopted ?? 0),
      rejected: Number(counts.rejected ?? 0)
    },
    filters: {
      status,
      limit
    }
  };
}

export async function setExperienceStatus(
  experienceId: string,
  status: Exclude<ExperienceStatus, "candidate">
) {
  const result = await pool.query(
    `update agent.experience_candidates
     set status = $2,
         adopted_at = case when $2 = 'adopted' then coalesce(adopted_at, now()) else null end,
         rejected_at = case when $2 = 'rejected' then coalesce(rejected_at, now()) else null end,
         updated_at = now()
     where id = $1
       and status <> $2
     returning *`,
    [experienceId, status]
  );

  if (result.rows[0]) {
    return {
      experience: toExperienceRecord(result.rows[0]),
      changed: true
    };
  }

  return {
    experience: await getExperience(experienceId),
    changed: false
  };
}
