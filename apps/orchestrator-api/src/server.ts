import "dotenv/config";
import express from "express";
import { z } from "zod";
import {
  appendJobEvent,
  cancelJob,
  createJob,
  getJob,
  getJobByFeishuMessageId,
  InvalidJobListCursorError,
  listJobs
} from "../../../packages/db/src/jobs";
import { markModelCallFailedUnknownOutcome } from "../../../packages/db/src/model-calls";
import {
  getGroupMessagesForJob,
  getJobDetails,
  getJobTimeline,
  InvalidTimelineCursorError
} from "../../../packages/db/src/pipeline";
import { INGRESS_ORIGINS, JOB_STATUSES } from "../../../packages/shared/src/types";
import { launchDbos, startJobWorkflow } from "./dbos-runtime";
import { ingressAdapters } from "./adapters";

const unstickModelCallSchema = z.object({
  jobId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  reason: z.string().optional(),
  restartWorkflow: z.boolean().optional().default(true)
});

const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().min(1).max(2000).optional()
});

const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  ingressOrigin: z.enum(INGRESS_ORIGINS).optional(),
  prompt: z.string().trim().min(1).max(300).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(["createdAt", "updatedAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  cursor: z.string().min(1).max(2000).optional()
});

const cancelJobSchema = z.object({
  reason: z.string().max(500).optional(),
  requesterId: z.string().max(200).optional()
});

const defaultCorsOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "tauri://localhost"
];

function getCorsOrigins() {
  return (process.env.ORCHESTRATOR_CORS_ORIGINS ?? defaultCorsOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function requireAdminToken(request: express.Request, response: express.Response) {
  const expectedToken = process.env.ADMIN_API_TOKEN?.trim();
  if (!expectedToken) {
    response.status(403).json({ error: "admin_api_token_not_configured" });
    return false;
  }

  const actualToken = request.header("x-admin-token")?.trim();
  if (actualToken !== expectedToken) {
    response.status(401).json({ error: "invalid_admin_token" });
    return false;
  }

  return true;
}

async function main() {
  const app = express();
  await launchDbos();
  const port = Number(process.env.ORCHESTRATOR_PORT ?? 3000);
  const corsOrigins = getCorsOrigins();

  app.use((request, response, next) => {
    const origin = request.header("origin");
    if (origin && corsOrigins.includes(origin)) {
      response.header("access-control-allow-origin", origin);
      response.header("vary", "Origin");
      response.header("access-control-allow-methods", "GET,POST,OPTIONS");
      response.header("access-control-allow-headers", "content-type,x-admin-token");
    }

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  for (const adapter of ingressAdapters) {
    if (adapter.isEnabled(process.env)) {
      adapter.mount(app, {
        createJob,
        getJobByFeishuMessageId,
        startJobWorkflow
      });
    }
  }

  app.post("/admin/model-calls/failed-unknown-outcome", async (request, response, next) => {
    try {
      if (!requireAdminToken(request, response)) {
        return;
      }

      const input = unstickModelCallSchema.parse(request.body);
      const job = await getJob(input.jobId);
      if (!job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      const modelCall = await markModelCallFailedUnknownOutcome({
        idempotencyKey: input.idempotencyKey,
        error: input.reason
          ? `failed_unknown_outcome: ${input.reason}`
          : "failed_unknown_outcome: manually marked by admin"
      });

      if (!modelCall) {
        response.status(404).json({ error: "started_model_call_not_found" });
        return;
      }

      await appendJobEvent(input.jobId, "tool.openclaw_agent_failed_unknown_outcome", {
        modelCallId: modelCall.id,
        idempotencyKey: modelCall.idempotencyKey,
        reason: input.reason ?? null
      }, {
        actor: "admin",
        stageId: modelCall.stageId
      });

      let workflowId: string | null = null;
      if (input.restartWorkflow) {
        const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
        workflowId = await startJobWorkflow(input.jobId, `job-${input.jobId}-unstick-${stamp}`);
      }

      response.json({
        ok: true,
        modelCallId: modelCall.id,
        status: modelCall.status,
        workflowId
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs", async (request, response, next) => {
    try {
      const query = listJobsQuerySchema.parse(request.query);
      const result = await listJobs(query);
      response.json(result);
    } catch (error) {
      if (error instanceof InvalidJobListCursorError) {
        response.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  app.get("/jobs/:jobId", async (request, response, next) => {
    try {
      const job = await getJob(request.params.jobId);

      if (!job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      response.json(job);
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs/:jobId/messages", async (request, response, next) => {
    try {
      const job = await getJob(request.params.jobId);

      if (!job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      const messages = await getGroupMessagesForJob(request.params.jobId);
      response.json({
        jobId: job.id,
        ingressOrigin: job.ingressOrigin,
        messages
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/jobs/:jobId/cancel", async (request, response, next) => {
    try {
      const input = cancelJobSchema.parse(request.body ?? {});
      const result = await cancelJob({
        jobId: request.params.jobId,
        reason: input.reason,
        requesterId: input.requesterId
      });

      if (!result.job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      if (result.reason === "already_terminal") {
        response.status(409).json({
          error: "job_already_terminal",
          jobId: result.job.id,
          status: result.job.status
        });
        return;
      }

      response.json({
        ok: true,
        changed: result.changed,
        reason: result.reason,
        jobId: result.job.id,
        status: result.job.status
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs/:jobId/details", async (request, response, next) => {
    try {
      const details = await getJobDetails(request.params.jobId);

      if (!details.job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      response.json(details);
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs/:jobId/timeline", async (request, response, next) => {
    try {
      const query = timelineQuerySchema.parse(request.query);
      const timeline = await getJobTimeline(request.params.jobId, {
        limit: query.limit,
        since: query.since,
        cursor: query.cursor
      });

      if (!timeline.job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      response.json(timeline);
    } catch (error) {
      if (error instanceof InvalidTimelineCursorError) {
        response.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: "invalid_request", issues: error.issues });
      return;
    }

    console.error(error);
    response.status(500).json({ error: "internal_error" });
  });

  app.listen(port, () => {
    console.log(`Orchestrator API listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
