import { appendJobEvent } from "../../../../../packages/db/src/jobs";
import { setGroupMessageFeishuId } from "../../../../../packages/db/src/pipeline";
import type { EgressAdapter } from "../../../../../packages/shared/src/types";
import { sendFeishuTextMessage } from "../../adapters/feishu";

export const feishuEgressAdapter: EgressAdapter = {
  name: "feishu",
  isEnabled: (env) => env.FEISHU_ADAPTER_ENABLED !== "false",
  async deliver(message) {
    if (message.feishuMessageId) {
      await appendJobEvent(
        message.jobId,
        "group.message_delivery_skipped",
        {
          messageId: message.groupMessageId,
          reason: "already_delivered",
          feishuMessageId: message.feishuMessageId
        },
        {
          actor: "feishu-gateway",
          stageId: message.stageId,
          groupMessageId: message.groupMessageId,
          feishuMessageId: message.feishuMessageId
        }
      );

      return {
        adapter: "feishu",
        mode: "skipped",
        messageId: message.groupMessageId,
        reason: "already_delivered"
      };
    }

    try {
      const result = await sendFeishuTextMessage({
        chatId: message.feishuChatId,
        senderAgentId: message.senderAgentId,
        mentionAgentId: message.mentionAgentId,
        text: message.content
      });

      if (result.mode === "sent") {
        await setGroupMessageFeishuId({
          groupMessageId: message.groupMessageId,
          jobId: message.jobId,
          feishuMessageId: result.feishuMessageId
        });

        return {
          adapter: "feishu",
          mode: "sent",
          messageId: message.groupMessageId,
          externalMessageId: result.feishuMessageId
        };
      }

      await appendJobEvent(
        message.jobId,
        "group.message_dry_run",
        {
          messageId: message.groupMessageId,
          reason: result.reason,
          senderAgentId: result.senderAgentId,
          mentionAgentId: message.mentionAgentId
        },
        {
          actor: "feishu-gateway",
          stageId: message.stageId,
          groupMessageId: message.groupMessageId
        }
      );

      return {
        adapter: "feishu",
        mode: "dry_run",
        messageId: message.groupMessageId,
        reason: result.reason
      };
    } catch (error) {
      await appendJobEvent(
        message.jobId,
        "group.message_delivery_failed",
        {
          messageId: message.groupMessageId,
          error: error instanceof Error ? error.message : String(error)
        },
        {
          actor: "feishu-gateway",
          stageId: message.stageId,
          groupMessageId: message.groupMessageId
        }
      );
      throw error;
    }
  }
};
