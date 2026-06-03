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
      requesterId: "web-panel",
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
      reason: "Cancelled from web panel",
      requesterId: "web-panel"
    })
  });
}
