const API_BASE = import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:3000";

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

export type RoutingMode =
  | "pipeline"
  | "supervisor_pipeline"
  | "classic_master_slave"
  | "master_slave_discussion";

export type ExperienceStatus = "candidate" | "adopted" | "rejected";

export type TaskPlanStatus = "draft" | "active" | "completed" | "archived";
export type TaskPlanItemStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled";

export type TaskPlanRecord = {
  id: string;
  jobId: string;
  title: string;
  summary: string | null;
  status: TaskPlanStatus;
  source: string;
  sourceArtifactId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TaskPlanItemRecord = {
  id: string;
  planId: string;
  position: number;
  title: string;
  body: string | null;
  status: TaskPlanItemStatus;
  agentId: string | null;
  stageId: string | null;
  artifactId: string | null;
  acceptanceCriteria: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TaskPlanWithItems = {
  plan: TaskPlanRecord;
  items: TaskPlanItemRecord[];
};

export type TaskPlanListSummary = TaskPlanRecord & {
  itemCount: number;
  completedItemCount: number;
  inProgressItemCount: number;
  blockedItemCount: number;
};

export type ListPlansInput = {
  jobId?: string;
  status?: TaskPlanStatus;
  limit?: number;
};

export type ListPlansResponse = {
  plans: TaskPlanListSummary[];
  filters: {
    jobId: string | null;
    status: TaskPlanStatus | null;
    limit: number;
  };
};

export type CreateJobPlanInput = {
  title?: string;
  summary?: string;
  source?: string;
  sourceArtifactId?: string | null;
  metadata?: Record<string, unknown>;
  syncItems?: boolean;
};

export type UpdatePlanInput = {
  title?: string;
  summary?: string | null;
  status?: TaskPlanStatus;
  metadata?: Record<string, unknown>;
};

export type CreatePlanItemInput = {
  title: string;
  body?: string | null;
  status?: TaskPlanItemStatus;
  agentId?: string | null;
  stageId?: string | null;
  artifactId?: string | null;
  acceptanceCriteria?: string[];
  metadata?: Record<string, unknown>;
};

export type UpdatePlanItemInput = Partial<CreatePlanItemInput>;

export type ExperienceRecord = {
  id: string;
  sourceJobId: string;
  kind: "routing_outcome";
  scope: "routing_mode";
  scopeKey: string;
  status: ExperienceStatus;
  summary: string;
  evidence: Array<Record<string, unknown>>;
  confidence: number;
  occurrenceCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  adoptedAt: string | null;
  rejectedAt: string | null;
};

export type ExperienceListResponse = {
  experiences: ExperienceRecord[];
  summary: {
    candidate: number;
    adopted: number;
    rejected: number;
  };
  filters: {
    status: ExperienceStatus | null;
    limit: number;
  };
};

export type RuntimeLogSource = "job_event" | "agent_event" | "model_call";

export type RuntimeLogEntry = {
  id: string;
  source: RuntimeLogSource;
  at: string;
  jobId: string;
  sessionId: string | null;
  stageId: string | null;
  actor: string | null;
  agentId: string | null;
  eventType: string;
  status: string | null;
  title: string;
  payload: Record<string, unknown> | null;
  error: string | null;
};

export type RuntimeLogsResponse = {
  entries: RuntimeLogEntry[];
  filters: {
    source: RuntimeLogSource | null;
    jobId: string | null;
    sessionId: string | null;
    since: string | null;
    until: string | null;
    limit: number;
  };
};

export type RuntimeUsageResponse = {
  summary: {
    jobs: {
      total: number;
      running: number;
      waiting: number;
      succeeded: number;
      failed: number;
      cancelled: number;
    };
    modelCalls: {
      total: number;
      started: number;
      succeeded: number;
      failed: number;
      failedUnknownOutcome: number;
    };
    events: {
      jobEvents: number;
      agentEvents: number;
      groupMessages: number;
      artifacts: number;
    };
  };
  byAgent: Array<{
    agentId: string;
    total: number;
    succeeded: number;
    failed: number;
    started: number;
  }>;
  byActionType: Array<{
    actionType: string;
    total: number;
    succeeded: number;
    failed: number;
    started: number;
  }>;
  recentFailures: Array<{
    id: string;
    jobId: string;
    agentId: string;
    actionType: string;
    status: string;
    error: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  filters: {
    since: string | null;
    until: string | null;
  };
};

export type RuntimeCapabilityStatus = "ready" | "partial" | "planned";

export type RuntimeCapability = {
  id: string;
  title: string;
  status: RuntimeCapabilityStatus;
  summary: string;
  routes: string[];
  implemented: string[];
  missing: string[];
  nextActions: string[];
};

export type RuntimeCapabilitiesResponse = {
  generatedAt: string;
  summary: {
    ready: number;
    partial: number;
    planned: number;
    total: number;
  };
  capabilities: RuntimeCapability[];
  recommendedNext: string[];
};

export type WorkspaceEntry = {
  name: string;
  relativePath: string;
  parentPath: string | null;
  kind: "file" | "directory";
  depth: number;
  size: number | null;
  modifiedAt: string | null;
  skipped: boolean;
};

export type WorkspaceGitChange = {
  status: string;
  path: string;
};

export type WorkspaceWriteMode = "create" | "overwrite" | "append";

export type WorkspaceInspectResponse = {
  rootPath: string;
  exists: boolean;
  isDirectory: boolean;
  modifiedAt: string;
  git: {
    isRepo: boolean;
    branch: string | null;
    head: string | null;
    dirty: boolean;
    changeCount: number;
  };
};

export type WorkspaceFilesInput = {
  rootPath: string;
  subpath?: string;
  depth?: number;
  limit?: number;
  includeHidden?: boolean;
};

export type WorkspaceFilesResponse = {
  rootPath: string;
  subpath: string;
  depth: number;
  limit: number;
  truncated: boolean;
  entries: WorkspaceEntry[];
};

export type WorkspaceFileInput = {
  rootPath: string;
  subpath: string;
  maxBytes?: number;
};

export type WorkspaceFileResponse = {
  rootPath: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  maxBytes: number;
  truncated: boolean;
  binary: boolean;
  encoding: "utf8" | null;
  content: string | null;
};

export type WorkspaceWriteFileInput = {
  rootPath: string;
  subpath: string;
  content: string;
  mode?: WorkspaceWriteMode;
  createParents?: boolean;
  approvalId: string;
};

export type WorkspaceWriteFileResponse = {
  approval: ToolApprovalRecord;
  file: {
    rootPath: string;
    relativePath: string;
    mode: WorkspaceWriteMode;
    bytes: number;
    size: number;
    modifiedAt: string;
  };
};

export type WorkspaceCommandRunInput = {
  rootPath: string;
  cwdSubpath?: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  approvalId: string;
};

export type WorkspaceCommandRunResponse = {
  approval: ToolApprovalRecord;
  command: {
    rootPath: string;
    cwdRelativePath: string;
    command: string;
    args: string[];
    displayCommand: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
};

export type WorkspaceGitStatusResponse = {
  rootPath: string;
  isRepo: boolean;
  branch: string | null;
  head: string | null;
  dirty: boolean;
  changeCount: number;
  changes: WorkspaceGitChange[];
};

export type ToolApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "consumed"
  | "expired"
  | "cancelled";

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export type ToolApprovalRecord = {
  id: string;
  jobId: string;
  sessionId: string;
  stageId: string | null;
  agentId: string;
  requesterActor: string;
  toolName: string;
  actionType: string;
  riskLevel: ToolRiskLevel;
  reason: string | null;
  command: string | null;
  target: string | null;
  input: Record<string, unknown>;
  policy: Record<string, unknown>;
  status: ToolApprovalStatus;
  decisionReason: string | null;
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
  consumedAt: string | null;
};

export type ListToolApprovalsInput = {
  status?: ToolApprovalStatus;
  jobId?: string;
  sessionId?: string;
  agentId?: string;
  riskLevel?: ToolRiskLevel;
  limit?: number;
};

export type ListToolApprovalsResponse = {
  approvals: ToolApprovalRecord[];
  filters: {
    status: ToolApprovalStatus | null;
    jobId: string | null;
    sessionId: string | null;
    agentId: string | null;
    riskLevel: ToolRiskLevel | null;
    limit: number;
  };
};

export type CreateToolApprovalInput = {
  jobId?: string;
  sessionId?: string;
  stageId?: string | null;
  agentId: string;
  requesterActor?: string;
  toolName: string;
  actionType: string;
  riskLevel?: ToolRiskLevel;
  reason?: string | null;
  command?: string | null;
  target?: string | null;
  input?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  expiresAt?: string | null;
};

export type DecideToolApprovalInput = {
  decidedBy?: string;
  decisionReason?: string | null;
};

export type ConsumeToolApprovalInput = {
  consumedBy?: string;
};

export type ToolApprovalDecisionResponse = {
  approval: ToolApprovalRecord;
  changed: boolean;
  reason: "not_found" | "not_pending" | "updated";
};

export type ToolApprovalConsumeResponse = {
  approval: ToolApprovalRecord;
  changed: boolean;
  reason: "not_found" | "not_approved" | "updated";
};

export type SessionSummary = {
  sessionId: string;
  jobId: string;
  status: JobStatus;
  routingMode: RoutingMode;
  rawPrompt: string;
  workdir: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  eventCount: number;
  modelCallCount: number;
  groupMessageCount: number;
  artifactCount: number;
};

export type SessionListResponse = {
  sessions: SessionSummary[];
  filters: {
    status: JobStatus | null;
    prompt: string | null;
    limit: number;
  };
};

export type SessionEventRecord = {
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

export type SessionEventsResponse = {
  sessionId: string;
  events: SessionEventRecord[];
  limit: number;
};

export type SessionEventsStreamInput = {
  afterSeq?: number;
  limit?: number;
  pollMs?: number;
  heartbeatMs?: number;
};

export type SessionArchiveInput = {
  retentionDays?: number;
  reason?: string;
  requesterId?: string;
};

export type SessionRestoreInput = {
  reason?: string;
  requesterId?: string;
};

export type SessionForkInput = {
  prompt?: string;
  inheritWorkdir?: boolean;
  startWorkflow?: boolean;
  routingMode?: RoutingMode;
  maxModelCalls?: number;
  classicFinalGateEnabled?: boolean;
  discussionRounds?: number;
  requesterId?: string;
};

export type SessionCompressionInput = {
  maxEvents?: number;
  reason?: string;
};

export type SessionCompressionResponse = {
  ok: boolean;
  sessionId: string;
  jobId: string;
  artifactId: string;
  summary: string;
  counts: {
    events: number;
    modelCalls: number;
    groupMessages: number;
    artifacts: number;
  };
};

export type JobRecord = {
  id: string;
  sessionId: string;
  status: JobStatus;
  ingressOrigin: string;
  routingMode: RoutingMode;
  maxModelCalls: number;
  classicFinalGateEnabled: boolean;
  discussionRounds: number;
  finalOutput: string | null;
  workdir: string | null;
  workflowId: string | null;
  requesterId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TimelineItem = {
  id: string;
  source: "job_event" | "agent_event" | "group_message" | "stage_attempt" | "test_review" | "artifact";
  at: string;
  eventType: string;
  title: string;
  actor?: string;
  stageId?: string | null;
  artifactId?: string | null;
  groupMessageId?: string | null;
  seq?: number;
  status?: string;
  payload?: Record<string, unknown>;
  cursor: string;
};

export type JobTimeline = {
  job: {
    id: string;
    status: JobStatus;
    ingressOrigin: string;
    routingMode: RoutingMode;
    workflowId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    completedAt: string | null;
  };
  summary: {
    stageCount: number;
    attemptCount: number;
    reviewCount: number;
    artifactCount: number;
    groupMessageCount: number;
    jobEventCount: number;
    agentEventCount: number;
    totalTimelineItems: number;
    matchedTimelineItems: number;
    returnedTimelineItems: number;
    truncated: boolean;
    hasMore: boolean;
    since: string | null;
    cursor: string | null;
    nextSince: string | null;
    nextCursor: string | null;
  };
  timeline: TimelineItem[];
};

export type CreateJobInput = {
  prompt: string;
  workdir?: string;
  routingMode: RoutingMode;
  maxModelCalls: number;
};

export type ListJobsInput = {
  limit?: number;
  status?: JobStatus;
  ingressOrigin?: string;
  prompt?: string;
  since?: string;
  until?: string;
  sort?: "createdAt" | "updatedAt";
  order?: "asc" | "desc";
  cursor?: string;
};

export type ListJobsResponse = {
  jobs: JobRecord[];
  page: {
    limit: number;
    returned: number;
    hasMore: boolean;
    nextCursor: string | null;
    cursor: string | null;
    sort: "createdAt" | "updatedAt";
    order: "asc" | "desc";
    filters: {
      status: JobStatus | null;
      ingressOrigin: string | null;
      prompt: string | null;
      since: string | null;
      until: string | null;
    };
  };
};

export type ListRuntimeLogsInput = {
  source?: RuntimeLogSource;
  jobId?: string;
  sessionId?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export type RuntimeUsageInput = {
  since?: string;
  until?: string;
};

export type ListSessionsInput = {
  limit?: number;
  status?: JobStatus;
  prompt?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function getHealth() {
  return request<{ ok: boolean }>("/health");
}

export async function listJobs(input: number | ListJobsInput = 50) {
  const options = typeof input === "number" ? { limit: input } : input;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return request<ListJobsResponse>(`/jobs?${params.toString()}`);
}

export async function createJob(input: CreateJobInput) {
  return request<{
    jobId: string;
    status: string;
    routingMode: RoutingMode;
    ingressOrigin: string;
  }>("/jobs", {
    method: "POST",
    body: JSON.stringify({
      prompt: input.prompt,
      workdir: input.workdir,
      requesterId: "desktop-app",
      routingMode: input.routingMode,
      maxModelCalls: input.maxModelCalls
    })
  });
}

export async function getJob(jobId: string) {
  return request<JobRecord>(`/jobs/${jobId}`);
}

export async function getJobTimeline(jobId: string, limit = 500, since?: string, cursor?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (since) {
    params.set("since", since);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  return request<JobTimeline>(`/jobs/${jobId}/timeline?${params.toString()}`);
}

export async function cancelJob(jobId: string) {
  return request<{
    ok: boolean;
    changed: boolean;
    reason: string;
    jobId: string;
    status: JobStatus;
  }>(`/jobs/${jobId}/cancel`, {
    method: "POST",
    body: JSON.stringify({
      reason: "Cancelled from desktop console",
      requesterId: "desktop-app"
    })
  });
}

export async function listExperiences(status?: ExperienceStatus, limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) {
    params.set("status", status);
  }
  return request<ExperienceListResponse>(`/memory/experiences?${params.toString()}`);
}

export async function listRuntimeLogs(input: ListRuntimeLogsInput = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return request<RuntimeLogsResponse>(`/runtime/logs?${params.toString()}`);
}

export async function getRuntimeUsage(input: RuntimeUsageInput = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return request<RuntimeUsageResponse>(`/runtime/usage?${params.toString()}`);
}

export async function getRuntimeCapabilities() {
  return request<RuntimeCapabilitiesResponse>("/runtime/capabilities");
}

export async function inspectWorkspace(rootPath: string) {
  const params = new URLSearchParams({ rootPath });
  return request<WorkspaceInspectResponse>(`/workspaces/inspect?${params.toString()}`);
}

export async function listWorkspaceFiles(input: WorkspaceFilesInput) {
  const params = new URLSearchParams({ rootPath: input.rootPath });
  for (const [key, value] of Object.entries(input)) {
    if (key !== "rootPath" && value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return request<WorkspaceFilesResponse>(`/workspaces/files?${params.toString()}`);
}

export async function readWorkspaceFile(input: WorkspaceFileInput) {
  const params = new URLSearchParams({ rootPath: input.rootPath, subpath: input.subpath });
  if (input.maxBytes !== undefined) {
    params.set("maxBytes", String(input.maxBytes));
  }
  return request<WorkspaceFileResponse>(`/workspaces/file?${params.toString()}`);
}

export async function writeWorkspaceFile(input: WorkspaceWriteFileInput) {
  return request<WorkspaceWriteFileResponse>("/workspaces/file/write", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function runWorkspaceCommand(input: WorkspaceCommandRunInput) {
  return request<WorkspaceCommandRunResponse>("/workspaces/command/run", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getWorkspaceGitStatus(rootPath: string) {
  const params = new URLSearchParams({ rootPath });
  return request<WorkspaceGitStatusResponse>(`/workspaces/git/status?${params.toString()}`);
}

export async function listToolApprovals(input: ListToolApprovalsInput = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return request<ListToolApprovalsResponse>(`/approvals?${params.toString()}`);
}

export async function createToolApproval(input: CreateToolApprovalInput) {
  return request<ToolApprovalRecord>("/approvals", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getToolApproval(approvalId: string) {
  return request<ToolApprovalRecord>(`/approvals/${encodeURIComponent(approvalId)}`);
}

export async function approveToolApproval(
  approvalId: string,
  input: DecideToolApprovalInput = {}
) {
  return request<ToolApprovalDecisionResponse>(
    `/approvals/${encodeURIComponent(approvalId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function rejectToolApproval(
  approvalId: string,
  input: DecideToolApprovalInput = {}
) {
  return request<ToolApprovalDecisionResponse>(
    `/approvals/${encodeURIComponent(approvalId)}/reject`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function cancelToolApproval(
  approvalId: string,
  input: DecideToolApprovalInput = {}
) {
  return request<ToolApprovalDecisionResponse>(
    `/approvals/${encodeURIComponent(approvalId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function consumeToolApproval(
  approvalId: string,
  input: ConsumeToolApprovalInput = {}
) {
  return request<ToolApprovalConsumeResponse>(
    `/approvals/${encodeURIComponent(approvalId)}/consume`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function listSessions(input: ListSessionsInput = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return request<SessionListResponse>(`/sessions?${params.toString()}`);
}

export async function getSessionEvents(sessionId: string, limit = 500) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<SessionEventsResponse>(`/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`);
}

export function createSessionEventsSource(
  sessionId: string,
  input: SessionEventsStreamInput = {}
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return new EventSource(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/events/stream${suffix}`
  );
}

export async function archiveSession(sessionId: string, input: SessionArchiveInput = {}) {
  return request<{ ok: boolean; changed: boolean; sessionId: string; job: JobRecord }>(
    `/sessions/${encodeURIComponent(sessionId)}/archive`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function restoreSession(sessionId: string, input: SessionRestoreInput = {}) {
  return request<{ ok: boolean; sessionId: string; job: JobRecord }>(
    `/sessions/${encodeURIComponent(sessionId)}/restore`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function forkSession(sessionId: string, input: SessionForkInput = {}) {
  return request<{
    ok: boolean;
    sourceSessionId: string;
    sessionId: string;
    job: JobRecord;
    workflowId: string | null;
  }>(`/sessions/${encodeURIComponent(sessionId)}/fork`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function compressSession(sessionId: string, input: SessionCompressionInput = {}) {
  return request<SessionCompressionResponse>(`/sessions/${encodeURIComponent(sessionId)}/compress`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listPlans(input: ListPlansInput = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return request<ListPlansResponse>(`/plans?${params.toString()}`);
}

export async function getPlan(planId: string) {
  return request<TaskPlanWithItems>(`/plans/${encodeURIComponent(planId)}`);
}

export async function createJobPlan(jobId: string, input: CreateJobPlanInput = {}) {
  return request<TaskPlanWithItems>(`/jobs/${encodeURIComponent(jobId)}/plan`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updatePlan(planId: string, input: UpdatePlanInput) {
  return request<TaskPlanRecord>(`/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function createPlanItem(planId: string, input: CreatePlanItemInput) {
  return request<TaskPlanItemRecord>(`/plans/${encodeURIComponent(planId)}/items`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updatePlanItem(
  planId: string,
  itemId: string,
  input: UpdatePlanItemInput
) {
  return request<TaskPlanItemRecord>(
    `/plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export async function adoptExperience(experienceId: string) {
  return request<{ experience: ExperienceRecord; changed: boolean }>(
    `/memory/experiences/${experienceId}/adopt`,
    {
      method: "POST",
      body: "{}"
    }
  );
}

export async function rejectExperience(experienceId: string) {
  return request<{ experience: ExperienceRecord; changed: boolean }>(
    `/memory/experiences/${experienceId}/reject`,
    {
      method: "POST",
      body: "{}"
    }
  );
}
