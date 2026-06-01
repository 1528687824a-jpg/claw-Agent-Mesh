import { archiveJobSession } from "../packages/db/src/jobs";
import { closePool, pool } from "../packages/db/src/pool";

type Args = {
  apply: boolean;
  limit: number;
  jobId: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    limit: 50,
    jobId: null
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error("--limit must be an integer between 1 and 500");
      }
      args.limit = value;
      continue;
    }
    if (arg === "--job-id") {
      const value = argv[++index]?.trim();
      if (!value) {
        throw new Error("--job-id requires a value");
      }
      args.jobId = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function findCandidates(args: Args) {
  const values: unknown[] = [];
  const where = ["status = 'cancelled'", "archived_at is null"];

  if (args.jobId) {
    values.push(args.jobId);
    where.push(`id = $${values.length}`);
  }

  values.push(args.limit);
  const result = await pool.query(
    `select id, completed_at, updated_at, cleanup_status
     from agent.jobs
     where ${where.join(" and ")}
     order by completed_at asc nulls last, updated_at asc, id asc
     limit $${values.length}`,
    values
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    cleanupStatus: row.cleanup_status ?? "active"
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await findCandidates(args);
  const repaired: Array<{
    id: string;
    archivedAt: string | null;
    retentionUntil: string | null;
    cleanupStatus: string;
  }> = [];

  if (args.apply) {
    for (const candidate of candidates) {
      const job = await archiveJobSession({
        jobId: candidate.id,
        reason: "job_cancelled"
      });
      repaired.push({
        id: job.id,
        archivedAt: job.archivedAt,
        retentionUntil: job.retentionUntil,
        cleanupStatus: job.cleanupStatus
      });
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      apply: args.apply,
      limit: args.limit,
      jobId: args.jobId,
      candidateCount: candidates.length,
      candidates,
      repairedCount: repaired.length,
      repaired
    })
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closePool);
