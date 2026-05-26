import "dotenv/config";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { setJobWorkflowId } from "../../../packages/db/src/jobs";
import { JobPipelineWorkflow } from "../../dbos-worker/src/workflows";

const DEFAULT_DATABASE_URL = "postgresql://temporal:temporal@localhost:5432/temporal";

let launchPromise: Promise<void> | null = null;

export async function launchDbos() {
  if (DBOS.isInitialized()) {
    return;
  }

  if (!launchPromise) {
    DBOS.setConfig({
      name: process.env.DBOS_APP_NAME ?? "agent-openclaw",
      systemDatabaseUrl:
        process.env.DBOS_SYSTEM_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
      systemDatabaseSchemaName: process.env.DBOS_SYSTEM_DATABASE_SCHEMA ?? "dbos",
      runAdminServer: process.env.DBOS_ADMIN_SERVER === "true",
      adminPort: Number(process.env.DBOS_ADMIN_PORT ?? 3001),
      logLevel: process.env.DBOS_LOG_LEVEL ?? "info"
    });

    launchPromise = DBOS.launch();
  }

  await launchPromise;
}

export async function startJobWorkflow(jobId: string, workflowIdOverride?: string) {
  await launchDbos();

  const workflowId = workflowIdOverride ?? `job-${jobId}`;
  const handle = await DBOS.startWorkflow(JobPipelineWorkflow, {
    workflowID: workflowId
  })({ jobId });

  await setJobWorkflowId(jobId, handle.workflowID);

  return handle.workflowID;
}
