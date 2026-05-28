import { appendJobEvent } from "../../../../packages/db/src/jobs";
import type {
  DeliveryResult,
  EgressAdapter,
  OutboundMessage
} from "../../../../packages/shared/src/types";
import { feishuEgressAdapter } from "./adapters/feishu";
import { httpEgressAdapter } from "./adapters/http";

const egressAdapters: EgressAdapter[] = [
  httpEgressAdapter,
  feishuEgressAdapter
];

function findAdapter(message: OutboundMessage) {
  return egressAdapters.find((adapter) => adapter.name === message.ingressOrigin) ?? null;
}

export async function deliverOutboundMessage(message: OutboundMessage): Promise<DeliveryResult> {
  const adapter = findAdapter(message);

  if (!adapter) {
    await appendJobEvent(
      message.jobId,
      "group.message_delivery_skipped",
      {
        messageId: message.groupMessageId,
        reason: "egress_adapter_not_found",
        ingressOrigin: message.ingressOrigin
      },
      {
        actor: "egress-dispatcher",
        stageId: message.stageId,
        groupMessageId: message.groupMessageId
      }
    );

    return {
      adapter: "none",
      mode: "skipped",
      messageId: message.groupMessageId,
      reason: "egress_adapter_not_found"
    };
  }

  if (!adapter.isEnabled(process.env)) {
    await appendJobEvent(
      message.jobId,
      "group.message_delivery_skipped",
      {
        messageId: message.groupMessageId,
        reason: "egress_adapter_disabled",
        ingressOrigin: message.ingressOrigin,
        adapter: adapter.name
      },
      {
        actor: "egress-dispatcher",
        stageId: message.stageId,
        groupMessageId: message.groupMessageId
      }
    );

    return {
      adapter: adapter.name,
      mode: "skipped",
      messageId: message.groupMessageId,
      reason: "egress_adapter_disabled"
    };
  }

  return adapter.deliver(message, { env: process.env });
}
