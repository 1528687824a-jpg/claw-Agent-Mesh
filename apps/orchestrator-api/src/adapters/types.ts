import type express from "express";
import type {
  IngressAdapter,
  JobRecord,
  RoutingMode
} from "../../../../packages/shared/src/types";

export type CreateJobForIngressInput = {
  rawPrompt: string;
  routingMode?: RoutingMode;
  maxModelCalls?: number;
  classicFinalGateEnabled?: boolean;
  discussionRounds?: number;
  requesterId?: string;
  feishuChatId?: string;
  feishuMessageId?: string;
};

export type IngressDeps = {
  createJob(input: CreateJobForIngressInput & { ingressOrigin: "http" | "feishu" }): Promise<JobRecord>;
  getJobByFeishuMessageId(feishuMessageId: string): Promise<JobRecord | null>;
  startJobWorkflow(jobId: string): Promise<string>;
};

export type ExpressIngressAdapter = IngressAdapter<express.Express, IngressDeps>;
