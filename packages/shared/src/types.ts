export type JobStatus =
  | "created"
  | "queued"
  | "planning"
  | "running"
  | "testing"
  | "fixing"
  | "waiting_for_human"
  | "succeeded"
  | "failed"
  | "cancelled";

export const ROUTING_MODES = [
  "pipeline",
  "supervisor_pipeline",
  "classic_master_slave",
  "master_slave_discussion"
] as const;

export type RoutingMode = (typeof ROUTING_MODES)[number];

export const DEFAULT_ROUTING_MODE: RoutingMode = "supervisor_pipeline";

export type JobRecord = {
  id: string;
  sessionId: string;
  rawPrompt: string;
  routingMode: RoutingMode;
  status: JobStatus;
  workflowId: string | null;
  finalOutput: string | null;
  workdir: string | null;
  feishuChatId: string | null;
  feishuMessageId: string | null;
  requesterId: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  retentionUntil: string | null;
  cleanupStatus: "active" | "retained" | "eligible" | "cleaned" | "cleanup_failed";
  retentionPolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateJobInput = {
  rawPrompt: string;
  routingMode?: RoutingMode;
  requesterId?: string;
  feishuChatId?: string;
  feishuMessageId?: string;
};

export type JobWorkflowInput = {
  jobId: string;
};

export type StageStatus =
  | "pending"
  | "running"
  | "test_pending"
  | "test_passed"
  | "test_failed"
  | "fixing"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "skipped";

export type TestVerdict = "PASS" | "FAIL_RETRYABLE" | "NEEDS_HUMAN";

export type ArtifactType =
  | "user_request"
  | "pipeline_plan"
  | "stage_input"
  | "stage_output"
  | "stage_summary"
  | "state_json"
  | "test_report"
  | "discussion_synthesis"
  | "final_output"
  | "group_message"
  | "log";

export type StageDefinition = {
  stageType: string;
  agentId: string;
  name: string;
  acceptanceCriteria: string[];
  maxRetries?: number;
};

export type StageRecord = {
  id: string;
  jobId: string;
  stageIndex: number;
  stageType: string;
  agentId: string;
  name: string;
  status: StageStatus;
  inputArtifactId: string | null;
  outputArtifactId: string | null;
  acceptanceCriteria: string[];
  retryCount: number;
  maxRetries: number;
  originalAgentSessionId: string | null;
  originalTestSessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArtifactRecord = {
  id: string;
  jobId: string;
  stageId: string | null;
  type: ArtifactType;
  title: string | null;
  content: string | null;
  uri: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type GroupMessageType =
  | "user_task"
  | "stage_output_to_test"
  | "test_pass_to_next_agent"
  | "test_fail_to_previous_agent"
  | "test_failed_waiting_for_user"
  | "pipeline_handoff"
  | "main_dispatch"
  | "discussion_handoff"
  | "final_output";

export type GroupMessageRecord = {
  id: string;
  jobId: string;
  stageId: string | null;
  senderAgentId: string;
  mentionAgentId: string | null;
  messageType: GroupMessageType;
  content: string;
  artifactId: string | null;
  feishuMessageId: string | null;
  createdAt: string;
};

export type AgentEventRecord = {
  id: string;
  sessionId: string;
  jobId: string;
  stageId: string | null;
  seq: number;
  actor: string;
  eventType: string;
  payload: Record<string, unknown>;
  artifactId: string | null;
  groupMessageId: string | null;
  feishuMessageId: string | null;
  createdAt: string;
};

export type StageRunResult = {
  attemptId: string;
  agentSessionId: string;
  outputArtifactId: string;
  outputPath: string;
  groupMessageId: string;
  summary: string;
};

export type TestReviewResult = {
  reviewId: string;
  testAgentSessionId: string;
  verdict: TestVerdict;
  issueCount: number;
  reportArtifactId: string;
  reportPath: string;
  groupMessageId: string;
};
