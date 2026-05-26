import "dotenv/config";
import express from "express";
import { z } from "zod";
import {
  appendJobEvent,
  createJob,
  getJob,
  getJobByFeishuMessageId
} from "../../../packages/db/src/jobs";
import { markModelCallFailedUnknownOutcome } from "../../../packages/db/src/model-calls";
import { getJobDetails } from "../../../packages/db/src/pipeline";
import { ROUTING_MODES } from "../../../packages/shared/src/types";
import { launchDbos, startJobWorkflow } from "./dbos-runtime";

const createJobSchema = z.object({
  rawPrompt: z.string().min(1),
  routingMode: z.enum(ROUTING_MODES).optional(),
  requesterId: z.string().optional(),
  feishuChatId: z.string().optional(),
  feishuMessageId: z.string().optional()
});

const unstickModelCallSchema = z.object({
  jobId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  reason: z.string().optional(),
  restartWorkflow: z.boolean().optional().default(true)
});

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

function parseFeishuTextContent(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text.trim() : content.trim();
  } catch {
    return content.trim();
  }
}

function removeFeishuMentionKeys(text: string, message: any): string {
  const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
  let cleaned = text;

  for (const mention of mentions) {
    if (typeof mention?.key === "string" && mention.key.trim()) {
      cleaned = cleaned.replaceAll(mention.key, "");
    }
  }

  return cleaned.trim();
}

function getFeishuRequesterId(body: any): string | undefined {
  return (
    body?.event?.sender?.sender_id?.user_id ??
    body?.event?.sender?.sender_id?.open_id ??
    body?.event?.sender?.sender_id?.union_id ??
    undefined
  );
}

function getFeishuEventToken(body: any): string | undefined {
  return body?.header?.token ?? body?.token ?? undefined;
}

function isKnownFeishuBotSender(body: any): boolean {
  const botOpenId = process.env.FEISHU_BOT_OPEN_ID?.trim();
  if (!botOpenId) {
    return false;
  }

  const sender = body?.event?.sender?.sender_id;
  return sender?.open_id === botOpenId || sender?.user_id === botOpenId || sender?.union_id === botOpenId;
}

async function main() {
  const app = express();
  await launchDbos();
  const port = Number(process.env.ORCHESTRATOR_PORT ?? 3000);

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/jobs", async (request, response, next) => {
    try {
      const input = createJobSchema.parse(request.body);
      const job = await createJob(input);
      const workflowId = await startJobWorkflow(job.id);

      response.status(201).json({
        jobId: job.id,
        routingMode: job.routingMode,
        status: "queued",
        workflowId
      });
    } catch (error) {
      next(error);
    }
  });

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

  app.post("/webhooks/feishu/events", async (request, response, next) => {
    try {
      const body = request.body as any;
      const expectedToken = process.env.FEISHU_VERIFICATION_TOKEN;
      const actualToken = getFeishuEventToken(body);

      if (expectedToken && actualToken !== expectedToken) {
        response.status(401).json({ error: "invalid_feishu_token" });
        return;
      }

      if (body?.challenge) {
        response.json({ challenge: body.challenge });
        return;
      }

      const message = body?.event?.message;
      if (!message?.message_id) {
        response.json({ ok: true, ignored: true, reason: "not_a_message_event" });
        return;
      }

      if (isKnownFeishuBotSender(body)) {
        response.json({ ok: true, ignored: true, reason: "bot_message_display_only" });
        return;
      }

      const existingJob = await getJobByFeishuMessageId(message.message_id);
      if (existingJob) {
        response.json({
          ok: true,
          duplicate: true,
          jobId: existingJob.id,
          workflowId: existingJob.workflowId
        });
        return;
      }

      const rawPrompt = removeFeishuMentionKeys(parseFeishuTextContent(message.content), message);
      if (!rawPrompt) {
        response.json({ ok: true, ignored: true, reason: "empty_message" });
        return;
      }

      const job = await createJob({
        rawPrompt,
        requesterId: getFeishuRequesterId(body),
        feishuChatId: message.chat_id,
        feishuMessageId: message.message_id
      });
      const workflowId = await startJobWorkflow(job.id);

      response.status(201).json({
        ok: true,
        jobId: job.id,
        routingMode: job.routingMode,
        workflowId
      });
    } catch (error) {
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
