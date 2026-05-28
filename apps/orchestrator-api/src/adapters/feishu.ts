import type { ExpressIngressAdapter } from "./types";

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

function isFeishuAdapterConfigured(env: NodeJS.ProcessEnv) {
  if (env.FEISHU_ADAPTER_ENABLED === "false") {
    return false;
  }

  return Boolean(
    env.FEISHU_ADAPTER_ENABLED === "true" ||
      env.FEISHU_APP_ID ||
      env.FEISHU_VERIFICATION_TOKEN ||
      env.FEISHU_DEFAULT_CHAT_ID ||
      env.FEISHU_BOT_OPEN_ID
  );
}

export const feishuIngressAdapter: ExpressIngressAdapter = {
  name: "feishu",
  isEnabled: isFeishuAdapterConfigured,
  mount(app, deps) {
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

        const existingJob = await deps.getJobByFeishuMessageId(message.message_id);
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

        const job = await deps.createJob({
          rawPrompt,
          ingressOrigin: "feishu",
          requesterId: getFeishuRequesterId(body),
          feishuChatId: message.chat_id,
          feishuMessageId: message.message_id
        });
        const workflowId = await deps.startJobWorkflow(job.id);

        response.status(201).json({
          ok: true,
          jobId: job.id,
          ingressOrigin: job.ingressOrigin,
          routingMode: job.routingMode,
          maxModelCalls: job.maxModelCalls,
          classicFinalGateEnabled: job.classicFinalGateEnabled,
          discussionRounds: job.discussionRounds,
          workflowId
        });
      } catch (error) {
        next(error);
      }
    });
  }
};
