import { appendJobEvent } from "../../../../../packages/db/src/jobs";
import type { EgressAdapter } from "../../../../../packages/shared/src/types";

export const httpEgressAdapter: EgressAdapter = {
  name: "http",
  isEnabled: () => true,
  async deliver(message) {
    await appendJobEvent(
      message.jobId,
      "group.message_available",
      {
        messageId: message.groupMessageId,
        ingressOrigin: message.ingressOrigin,
        retrieval: `GET /jobs/${message.jobId}/messages`
      },
      {
        actor: "http-egress",
        stageId: message.stageId,
        artifactId: message.artifactId,
        groupMessageId: message.groupMessageId
      }
    );

    return {
      adapter: "http",
      mode: "available",
      messageId: message.groupMessageId
    };
  }
};
