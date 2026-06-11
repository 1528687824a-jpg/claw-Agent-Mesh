import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  appendJobEvent,
  archiveJobSession,
  getJob,
  setJobFinalOutput,
  setJobStatus,
  setJobWorkdir
} from "../../../packages/db/src/jobs";
import {
  completeStageAttempt,
  createArtifact,
  createGroupMessage,
  createPipelineStages,
  getArtifact,
  getNextStage,
  getStage,
  getStagesForJob,
  markStageCompleted,
  markStageFixing,
  markStageWaitingForHuman,
  saveTestReview,
  setNextStageInput,
  startStageAttempt
} from "../../../packages/db/src/pipeline";
import {
  countModelCallsForJob,
  getModelCallByKey,
  markModelCallFailed,
  markModelCallStarted,
  markModelCallSucceeded
} from "../../../packages/db/src/model-calls";
import { getAgentEventsForJob } from "../../../packages/db/src/session";
import { createExperienceCandidate } from "../../../packages/db/src/experience";
import type {
  AgentEventRecord,
  ArtifactRecord,
  FinalQualityGateResult,
  GroupMessageRecord,
  GroupMessageType,
  RoutingMode,
  StageDefinition,
  StageRecord,
  StageRunResult,
  TestReviewResult
} from "../../../packages/shared/src/types";
import {
  DEFAULT_DISCUSSION_ROUNDS,
  DEFAULT_MAX_MODEL_CALLS,
  DEFAULT_ROUTING_MODE
} from "../../../packages/shared/src/types";
import { redactAgentRuntime, resolveAgentRuntime } from "./agent-runtime";
import { runOpenClawAgent, type OpenClawRunResult } from "./adapters/openclaw";
import { loadClusterConfig } from "./config/cluster";
import { deliverOutboundMessage } from "./egress/dispatcher";
import { maybeCrashOnce } from "./test-crash";

type OpenClawActionType =
  | "stage-agent"
  | "test-agent"
  | "main-agent-synthesis"
  | "final-test-agent";

function nowIso() {
  return new Date().toISOString();
}

function stageTypeToAgentType(stageType: string) {
  return stageType === "write" ? "writing" : stageType;
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function toSafeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/\u0000/g, "");
}

function getModelCallResult(payload: Record<string, unknown> | null): OpenClawRunResult | null {
  if (!payload || !("result" in payload)) {
    return null;
  }

  return payload.result as OpenClawRunResult | null;
}

async function runOpenClawAgentIdempotent(input: {
  jobId: string;
  stageId?: string | null;
  stageIndex: number;
  attemptNo: number;
  actionType: OpenClawActionType;
  agentId: string;
  sessionId: string;
  message: string;
  timeoutSeconds: number;
}): Promise<OpenClawRunResult | null> {
  const idempotencyKey = [
    input.jobId,
    input.stageId ?? "job",
    input.attemptNo,
    input.actionType
  ].join(":");
  const existing = await getModelCallByKey(idempotencyKey);
  const route = await resolveAgentRuntime({ requestedAgentId: input.agentId });
  const redactedRoute = redactAgentRuntime(route);

  if (existing?.status === "succeeded") {
    await appendJobEvent(
      input.jobId,
      "tool.openclaw_agent_reused",
      {
        stageId: input.stageId,
        agentId: route.honeycombAgentId,
        requestedAgentId: input.agentId,
        openclawAgentId: route.openclawAgentId,
        attemptNo: input.attemptNo,
        actionType: input.actionType,
        modelCallId: existing.id,
        idempotencyKey,
        route: redactedRoute
      },
      {
        actor: "tool-gateway",
        stageId: input.stageId ?? null
      }
    );
    return getModelCallResult(existing.responsePayload);
  }

  if (existing?.status === "started") {
    throw new Error(
      `Ambiguous OpenClaw model call already started without a completed result: ${idempotencyKey}`
    );
  }

  await markModelCallStarted({
    idempotencyKey,
    jobId: input.jobId,
    stageId: input.stageId,
    attemptNo: input.attemptNo,
    actionType: input.actionType,
    agentId: route.honeycombAgentId,
    agentSessionId: input.sessionId,
    requestHash: sha256(input.message)
  });

  await appendJobEvent(
    input.jobId,
    "tool.openclaw_agent_requested",
    {
      stageId: input.stageId,
      agentId: route.honeycombAgentId,
      requestedAgentId: input.agentId,
      openclawAgentId: route.openclawAgentId,
      attemptNo: input.attemptNo,
      actionType: input.actionType,
      idempotencyKey,
      mode: process.env.OPENCLAW_AGENT_MODE === "real" ? "real" : "mock",
      route: redactedRoute
    },
    {
      actor: "tool-gateway",
      stageId: input.stageId ?? null
    }
  );

  try {
    const result = await runOpenClawAgent({
      agentId: route.openclawAgentId,
      sessionId: input.sessionId,
      message: input.message,
      provider: {
        providerId: route.providerId,
        baseUrl: route.providerBaseUrl,
        model: route.model,
        apiKey: route.apiKey
      },
      timeoutSeconds: input.timeoutSeconds
    });

    await markModelCallSucceeded({
      idempotencyKey,
      responsePayload: {
        result,
        route: redactedRoute
      }
    });

    await appendJobEvent(
      input.jobId,
      "tool.openclaw_agent_completed",
      {
        stageId: input.stageId,
        agentId: route.honeycombAgentId,
        requestedAgentId: input.agentId,
        openclawAgentId: route.openclawAgentId,
        attemptNo: input.attemptNo,
        actionType: input.actionType,
        idempotencyKey,
        mode: result?.mode ?? null,
        sessionId: result?.sessionId ?? input.sessionId,
        route: redactedRoute
      },
      {
        actor: "tool-gateway",
        stageId: input.stageId ?? null
      }
    );

    maybeCrashOnce(
      `after-openclaw-${input.actionType}-stage-${input.stageIndex
        .toString()
        .padStart(3, "0")}-attempt-${input.attemptNo.toString().padStart(2, "0")}`,
      input.jobId
    );

    return result;
  } catch (error) {
    await markModelCallFailed({
      idempotencyKey,
      error: toSafeErrorMessage(error)
    });
    throw new Error(toSafeErrorMessage(error));
  }
}

function toWslPath(inputPath: string) {
  const match = inputPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) {
    return inputPath.replace(/\\/g, "/");
  }

  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function displayOnlyHandoffLine(targetAgentId: string | null | undefined, note?: string) {
  if (!targetAgentId) {
    return "显示说明：这条消息只用于群内展示；实际状态以本地 DBOS/Postgres 为准。";
  }

  return `显示说明：@${targetAgentId}${note ? `（${note}）` : ""}只给用户看；实际交接已在本地编排服务完成。`;
}

async function postGroupMessage(input: {
  jobId: string;
  stageId?: string | null;
  senderAgentId: string;
  mentionAgentId?: string | null;
  messageType: GroupMessageType;
  content: string;
  artifactId?: string | null;
  id?: string;
}): Promise<GroupMessageRecord> {
  const job = await getJob(input.jobId);
  const groupMessage = await createGroupMessage(input);

  await deliverOutboundMessage({
    groupMessageId: groupMessage.id,
    jobId: groupMessage.jobId,
    stageId: groupMessage.stageId,
    ingressOrigin: job?.ingressOrigin ?? "http",
    senderAgentId: groupMessage.senderAgentId,
    mentionAgentId: groupMessage.mentionAgentId,
    messageType: groupMessage.messageType,
    content: groupMessage.content,
    artifactId: groupMessage.artifactId,
    feishuChatId: job?.feishuChatId ?? null,
    feishuMessageId: groupMessage.feishuMessageId
  });

  return groupMessage;
}

export async function markJobRunning(jobId: string) {
  await setJobStatus(jobId, "running");
}

export async function isJobCancelled(jobId: string) {
  const job = await getJob(jobId);
  return job?.status === "cancelled";
}

export async function getJobRoutingMode(jobId: string): Promise<RoutingMode> {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const routingMode = job.routingMode ?? DEFAULT_ROUTING_MODE;
  await appendJobEvent(jobId, "main.routing_mode_selected", { routingMode });
  return routingMode;
}

export async function getJobDiscussionRounds(jobId: string): Promise<number> {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const discussionRounds = job.discussionRounds ?? DEFAULT_DISCUSSION_ROUNDS;
  await appendJobEvent(jobId, "discussion.round_count_selected", { discussionRounds });
  return discussionRounds;
}

export async function enforceModelCallBudget(input: {
  jobId: string;
  nextActionType: OpenClawActionType;
  nextAgentId: string;
}) {
  const job = await getJob(input.jobId);
  if (!job) {
    throw new Error(`Job not found: ${input.jobId}`);
  }

  const currentModelCalls = await countModelCallsForJob(input.jobId);
  const maxModelCalls = job.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS;
  const allowed = currentModelCalls < maxModelCalls;

  if (!allowed) {
    const reason = `Model-call budget exhausted before ${input.nextActionType}`;
    await setJobStatus(input.jobId, "waiting_for_human", {
      reason,
      currentModelCalls,
      maxModelCalls,
      nextActionType: input.nextActionType,
      nextAgentId: input.nextAgentId
    });
    await appendJobEvent(input.jobId, "budget.model_calls_exhausted", {
      currentModelCalls,
      maxModelCalls,
      nextActionType: input.nextActionType,
      nextAgentId: input.nextAgentId
    });
  }

  return {
    allowed,
    currentModelCalls,
    maxModelCalls,
    nextActionType: input.nextActionType,
    nextAgentId: input.nextAgentId
  };
}

export async function shouldRunFinalQualityGate(input: {
  jobId: string;
  routingMode: RoutingMode;
}) {
  const job = await getJob(input.jobId);
  if (!job) {
    throw new Error(`Job not found: ${input.jobId}`);
  }

  const enabled =
    input.routingMode === "pipeline" ||
    input.routingMode === "master_slave_discussion" ||
    (input.routingMode === "classic_master_slave" && job.classicFinalGateEnabled);

  await appendJobEvent(input.jobId, "final.quality_gate_decision", {
    routingMode: input.routingMode,
    enabled,
    classicFinalGateEnabled: job.classicFinalGateEnabled
  });

  return {
    enabled,
    routingMode: input.routingMode,
    source: input.routingMode === "classic_master_slave" ? "job.classicFinalGateEnabled" : "routingMode"
  };
}

export async function getLatestStageOutputArtifactId(jobId: string) {
  const stages = await getStagesForJob(jobId);
  const latestStageWithOutput = [...stages]
    .reverse()
    .find((stage) => typeof stage.outputArtifactId === "string" && stage.outputArtifactId);

  if (!latestStageWithOutput?.outputArtifactId) {
    throw new Error(`No stage output artifact found for job: ${jobId}`);
  }

  return latestStageWithOutput.outputArtifactId;
}

export async function markJobPlanning(jobId: string) {
  await setJobStatus(jobId, "planning");
}

export async function markJobWaitingForHuman(jobId: string, reason: string) {
  await setJobStatus(jobId, "waiting_for_human", { reason });
}

export async function markJobFailed(jobId: string, reason: string) {
  await setJobStatus(jobId, "failed", { reason });
}

export async function prepareJobWorkspace(jobId: string) {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const root = path.resolve(process.env.JOB_DATA_DIR ?? "data/jobs", jobId);
  const inputDir = path.join(root, "input");
  const planDir = path.join(root, "plan");
  const logsDir = path.join(root, "logs");
  const finalDir = path.join(root, "final");

  await mkdir(inputDir, { recursive: true });
  await mkdir(planDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(finalDir, { recursive: true });

  const requestPath = path.join(inputDir, "user-request.md");
  await writeFile(requestPath, job.rawPrompt, "utf8");

  const logPath = path.join(logsDir, "main-log.md");
  await writeFile(logPath, `# Main Log\n\n- Job ${jobId} prepared.\n`, "utf8");

  await setJobWorkdir(jobId, root);

  const userRequest = await createArtifact({
    id: `${jobId}-ART-USER-REQUEST`,
    jobId,
    type: "user_request",
    title: "User request",
    content: job.rawPrompt,
    uri: requestPath
  });

  await createArtifact({
    id: `${jobId}-ART-MAIN-LOG`,
    jobId,
    type: "log",
    title: "Main log",
    uri: logPath
  });

  await postGroupMessage({
    id: `${jobId}-MSG-USER-TASK`,
    jobId,
    senderAgentId: "user",
    mentionAgentId: "main-agent",
    messageType: "user_task",
    artifactId: userRequest.id,
    content: [
      `@main-agent 新任务 ${jobId}`,
      displayOnlyHandoffLine("main-agent", "真人输入，进入主 Agent 编排"),
      "",
      job.rawPrompt,
      "",
      `用户需求 artifact：${requestPath}`
    ].join("\n")
  });

  return {
    workdir: root,
    userRequestArtifactId: userRequest.id
  };
}

function inferStagesFromPrompt(rawPrompt: string): StageDefinition[] {
  const needsResearch =
    /研究|调研|资料|网上|搜索|查询|查一下|最新|现状|竞品|事实|数据|来源|research|search|latest|current/i.test(
      rawPrompt
    );
  const needsWriting =
    /文案|文章|脚本|故事|标题|邮件|公告|推文|方案|报告|总结|润色|写|copy|story|script|write|writing|content/i.test(
      rawPrompt
    );
  const needsImage =
    /图片|图像|插画|海报|封面|配图|视觉|生成图|image|picture|illustration|poster|visual/i.test(
      rawPrompt
    );
  const needsVideo =
    /视频|短片|动画|分镜|镜头|运镜|动态画面|生成视频|video|movie|clip|animation|animate|storyboard/i.test(
      rawPrompt
    );

  const stages: StageDefinition[] = [];

  if (needsResearch) {
    stages.push({
      stageType: "research",
      agentId: "research-agent",
      name: "Collect task context",
      acceptanceCriteria: [
        "Gather relevant sources or context when external facts are needed",
        "Summarize facts, assumptions, risks, and useful constraints",
        "Provide a handoff that the next child agent or main-agent can consume"
      ],
      maxRetries: 3
    });
  }

  if (needsWriting || (!needsResearch && !needsImage && !needsVideo)) {
    stages.push({
      stageType: "write",
      agentId: "writer-agent",
      name: "Write requested content",
      acceptanceCriteria: [
        "Use the user request and upstream artifact as input",
        "Produce the requested copy, article, script, story, summary, or written content",
        "Include a handoff note if a later stage needs to use this text"
      ],
      maxRetries: 3
    });
  }

  if (needsImage) {
    stages.push({
      stageType: "image",
      agentId: "image-agent",
      name: "Generate requested image output",
      acceptanceCriteria: [
        "Use the user request and upstream artifact as input",
        "Produce an image brief, image prompt, or image artifact path according to the task",
        "Preserve important constraints, style, subject, and usage requirements"
      ],
      maxRetries: 3
    });
  }

  if (needsVideo) {
    stages.push({
      stageType: "video",
      agentId: "video-agent",
      name: "Generate requested video output",
      acceptanceCriteria: [
        "Use the user request and upstream artifact as input",
        "Produce a video brief, storyboard, video prompt, or video artifact path according to the task",
        "Preserve important constraints, style, subject, motion, timing, and usage requirements"
      ],
      maxRetries: 3
    });
  }

  return stages;
}

export async function createPipelinePlan(input: {
  jobId: string;
  userRequestArtifactId: string;
}): Promise<StageRecord[]> {
  await markJobPlanning(input.jobId);
  const job = await getJob(input.jobId);
  if (!job) {
    throw new Error(`Job not found: ${input.jobId}`);
  }

  const workdir = job.workdir ?? path.resolve(process.env.JOB_DATA_DIR ?? "data/jobs", input.jobId);
  const planPath = path.join(workdir, "plan", "pipeline-plan.json");
  const rawPrompt = job.rawPrompt;
  const clusterConfig = await loadClusterConfig();
  const stages: StageDefinition[] = clusterConfig?.stages ?? inferStagesFromPrompt(rawPrompt);

  const plan = {
    jobId: input.jobId,
    sourceArtifactId: input.userRequestArtifactId,
    planningAgentId: "main-agent",
    routingMode: job.routingMode ?? clusterConfig?.defaultRoutingMode ?? DEFAULT_ROUTING_MODE,
    clusterConfig: clusterConfig
      ? {
          clusterId: clusterConfig.clusterId,
          name: clusterConfig.name,
          configPath: clusterConfig.configPath,
          planner: clusterConfig.source.planner
        }
      : null,
    stages
  };

  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  await createArtifact({
    id: `${input.jobId}-ART-PIPELINE-PLAN`,
    jobId: input.jobId,
    type: "pipeline_plan",
    title: "Main-agent pipeline plan",
    content: JSON.stringify(plan, null, 2),
    uri: planPath
  });

  await appendJobEvent(input.jobId, "main.pipeline_planned", {
    planPath,
    routingMode: plan.routingMode,
    stageCount: plan.stages.length,
    clusterId: clusterConfig?.clusterId ?? null
  });

  return createPipelineStages(input.jobId, plan.stages, input.userRequestArtifactId);
}

export async function runStageAgent(input: {
  jobId: string;
  stageId: string;
  attemptNo: number;
  routingMode?: RoutingMode;
  handoffTargetAgentId?: string | null;
  outputMessageType?: GroupMessageType;
}): Promise<StageRunResult> {
  const [job, stage] = await Promise.all([getJob(input.jobId), getStage(input.stageId)]);
  if (!job) {
    throw new Error(`Job not found: ${input.jobId}`);
  }

  const routingMode = input.routingMode ?? job.routingMode ?? DEFAULT_ROUTING_MODE;
  const handoffTargetAgentId =
    input.handoffTargetAgentId === undefined ? "test-agent" : input.handoffTargetAgentId;
  const outputMessageType = input.outputMessageType ?? "stage_output_to_test";
  const workdir = job.workdir ?? path.resolve(process.env.JOB_DATA_DIR ?? "data/jobs", input.jobId);
  const stageDir = path.join(
    workdir,
    "stages",
    `${stage.stageIndex.toString().padStart(3, "0")}-${stage.stageType}`
  );
  const stateDir = path.join(workdir, "state");
  const workLogPath = path.join(workdir, "agent-work-log.md");
  await mkdir(stageDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const agentSessionId =
    stage.originalAgentSessionId ??
    `${job.sessionId}:${stage.agentId}:stage-${stage.stageIndex.toString().padStart(3, "0")}`;
  const attemptId = await startStageAttempt({
    stageId: stage.id,
    attemptNo: input.attemptNo,
    agentId: stage.agentId,
    agentSessionId,
    inputArtifactId: stage.inputArtifactId
  });

  await appendJobEvent(
    input.jobId,
    "stage.agent_started",
    {
      stageId: stage.id,
      agentId: stage.agentId,
      attemptNo: input.attemptNo,
      agentSessionId,
      routingMode,
      handoffTargetAgentId,
      outputMessageType
    },
    {
            actor: "dbos-harness",
      stageId: stage.id
    }
  );

  const shouldForceFirstFailure =
    stage.stageIndex === 1 &&
    input.attemptNo === 1 &&
    /force fail|强制失败|测试失败/i.test(job.rawPrompt);
  const shouldAlwaysFail =
    stage.stageIndex === 1 && /always fail|连续失败|三次失败|一直失败/i.test(job.rawPrompt);

  const quality = shouldForceFirstFailure || shouldAlwaysFail ? "needs_fix" : "ready_for_test";
  const upstreamArtifact = stage.inputArtifactId ? await getArtifact(stage.inputArtifactId) : null;
  const agentPrompt = [
    `工作模式：${input.attemptNo === 1 ? "生产" : "修正"}`,
    `任务编号：${input.jobId}`,
    `阶段编号：${stage.stageIndex}`,
    `阶段类型：${stage.stageType}`,
    `阶段任务：${stage.name}`,
    `输出目录（Windows）：${stageDir}`,
    `输出目录（WSL）：${toWslPath(stageDir)}`,
    `工作日志路径（Windows）：${workLogPath}`,
    `工作日志路径（WSL）：${toWslPath(workLogPath)}`,
    `状态 JSON 目录（Windows）：${stateDir}`,
    `状态 JSON 目录（WSL）：${toWslPath(stateDir)}`,
    `上游产物路径：${upstreamArtifact?.uri ?? "无"}`,
    "",
    "请按你的 agent prompt 完成本阶段，只返回产物路径、工作日志路径、状态 JSON 路径。"
  ].join("\n");

  const openClawResult = await runOpenClawAgentIdempotent({
    jobId: input.jobId,
    stageId: stage.id,
    stageIndex: stage.stageIndex,
    attemptNo: input.attemptNo,
    actionType: "stage-agent",
    agentId: stage.agentId,
    sessionId: agentSessionId,
    message: agentPrompt,
    timeoutSeconds: Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS ?? 600)
  });

  const output = {
    task_id: input.jobId,
    stage_number: stage.stageIndex,
    agent_type: stageTypeToAgentType(stage.stageType),
    agent_name: stage.agentId,
    mode: input.attemptNo === 1 ? "production" : "correction",
    status: quality === "needs_fix" ? "needs_retry" : "completed",
    artifact_path: "",
    work_log_path: workLogPath,
    summary_path: workLogPath,
    upstream_artifact_paths: upstreamArtifact?.uri ? [upstreamArtifact.uri] : [],
    created_at: nowIso(),
    jobId: input.jobId,
    stageId: stage.id,
    stageName: stage.name,
    agentId: stage.agentId,
    attemptNo: input.attemptNo,
    routingMode,
    handoffTargetAgentId,
    quality,
    summary:
      openClawResult?.text ??
      (quality === "needs_fix"
        ? shouldAlwaysFail
          ? "Mock output keeps failing so the test agent can stop after three consecutive failures."
          : "Mock output intentionally omits the handoff note so the test agent can force a repair loop."
        : `Mock ${stage.agentId} completed ${stage.name}.`),
    handoff:
      quality === "needs_fix"
        ? null
        : {
            nextStageInput: `Output from ${stage.name}`,
            notes: `Use this artifact as input for the next stage.`
          },
    openclaw: openClawResult
      ? {
          mode: openClawResult.mode,
          sessionId: openClawResult.sessionId
        }
      : {
          mode: "mock",
          sessionId: agentSessionId
        },
    acceptanceCriteria: stage.acceptanceCriteria
  };

  const stateJsonPath = path.join(
    stateDir,
    `stage-${stage.stageIndex.toString().padStart(3, "0")}-${stageTypeToAgentType(
      stage.stageType
    )}-output.json`
  );
  const outputMdPath = path.join(stageDir, `output-attempt-${input.attemptNo}.md`);
  output.artifact_path = outputMdPath;

  await writeFile(stateJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(
    outputMdPath,
    [
      `# ${stage.name}`,
      "",
      `Agent: ${stage.agentId}`,
      `Attempt: ${input.attemptNo}`,
      `Quality: ${quality}`,
      "",
      output.summary,
      ""
    ].join("\n"),
    "utf8"
  );
  await appendFile(
    workLogPath,
    [
      `## 阶段 ${stage.stageIndex} ${stage.agentId} 第 ${input.attemptNo} 次`,
      `- 时间：${output.created_at}`,
      `- 产物：${outputMdPath}`,
      `- 状态 JSON：${stateJsonPath}`,
      `- 摘要：${output.summary}`,
      ""
    ].join("\n"),
    "utf8"
  );

  const artifact = await createArtifact({
    id: `${stage.id}-ART-OUTPUT-${input.attemptNo.toString().padStart(2, "0")}`,
    jobId: input.jobId,
    stageId: stage.id,
    type: "stage_output",
    title: `${stage.name} output attempt ${input.attemptNo}`,
    content: JSON.stringify(output, null, 2),
    uri: stateJsonPath,
    metadata: {
      markdownPath: outputMdPath,
      workLogPath,
      stateJsonPath,
      agentSessionId,
      attemptNo: input.attemptNo,
      routingMode,
      handoffTargetAgentId,
      quality
    }
  });

  await createArtifact({
    id: `${stage.id}-ART-SUMMARY-${input.attemptNo.toString().padStart(2, "0")}`,
    jobId: input.jobId,
    stageId: stage.id,
    type: "stage_summary",
    title: `${stage.name} work log attempt ${input.attemptNo}`,
    content: output.summary,
    uri: workLogPath,
    metadata: {
      stateJsonPath,
      attemptNo: input.attemptNo
    }
  });

  await completeStageAttempt({
    attemptId,
    stageId: stage.id,
    outputArtifactId: artifact.id,
    status: "completed"
  });

  await appendJobEvent(input.jobId, "stage.agent_completed", {
    stageId: stage.id,
    agentId: stage.agentId,
    attemptNo: input.attemptNo,
    routingMode,
    handoffTargetAgentId,
    outputMessageType,
    outputArtifactId: artifact.id
  });

  const groupMessage = await postGroupMessage({
    id: `${stage.id}-MSG-STAGE-OUTPUT-${input.attemptNo.toString().padStart(2, "0")}`,
    jobId: input.jobId,
    stageId: stage.id,
    senderAgentId: stage.agentId,
    mentionAgentId: handoffTargetAgentId,
    messageType: outputMessageType,
    artifactId: artifact.id,
    content: [
      handoffTargetAgentId
        ? `@${handoffTargetAgentId} stage output is ready: ${stage.name}`
        : `Stage output is ready for main-agent: ${stage.name}`,
      displayOnlyHandoffLine(handoffTargetAgentId, `mode=${routingMode}`),
      "",
      `Job: ${input.jobId}`,
      `Routing mode: ${routingMode}`,
      `Stage: ${stage.stageIndex} / ${stage.stageType}`,
      `Agent: ${stage.agentId}`,
      `Attempt: ${input.attemptNo}`,
      `Output artifact: ${artifact.id}`,
      `Output path: ${stateJsonPath}`,
      `Work log: ${workLogPath}`,
      "",
      `Summary: ${output.summary}`
    ].join("\n")
  });

  return {
    attemptId,
    agentSessionId,
    outputArtifactId: artifact.id,
    outputPath: stateJsonPath,
    groupMessageId: groupMessage.id,
    summary: output.summary
  };
}

export async function runTestAgent(input: {
  jobId: string;
  stageId: string;
  attemptId: string;
  attemptNo: number;
  outputArtifactId: string;
}): Promise<TestReviewResult> {
  const [job, stage, outputArtifact] = await Promise.all([
    getJob(input.jobId),
    getStage(input.stageId),
    getArtifact(input.outputArtifactId)
  ]);
  if (!job) {
    throw new Error(`Job not found: ${input.jobId}`);
  }

  const parsed = outputArtifact.content ? JSON.parse(outputArtifact.content) : {};
  const testAgentId = "test-agent";
  const testAgentSessionId =
    stage.originalTestSessionId ??
    `${job.sessionId}:${testAgentId}:stage-${stage.stageIndex.toString().padStart(3, "0")}`;

  const workdir = job.workdir ?? path.resolve(process.env.JOB_DATA_DIR ?? "data/jobs", input.jobId);
  const stageDir = path.join(
    workdir,
    "stages",
    `${stage.stageIndex.toString().padStart(3, "0")}-${stage.stageType}`
  );
  const stateDir = path.join(workdir, "state");
  const workLogPath = String(parsed.work_log_path ?? path.join(workdir, "agent-work-log.md"));
  await mkdir(stageDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const testPrompt = [
    `测试类型：${stageTypeToAgentType(stage.stageType)}`,
    `任务编号：${input.jobId}`,
    `阶段编号：${stage.stageIndex}`,
    `待测产物路径：${outputArtifact.uri ?? "无"}`,
    `工作日志路径：${workLogPath}`,
    `输出目录（Windows）：${stageDir}`,
    `输出目录（WSL）：${toWslPath(stageDir)}`,
    "",
    "请按 test-agent prompt 审查并只返回测试结果、报告路径、状态JSON路径。"
  ].join("\n");

  const openClawTestResult = await runOpenClawAgentIdempotent({
    jobId: input.jobId,
    stageId: stage.id,
    stageIndex: stage.stageIndex,
    attemptNo: input.attemptNo,
    actionType: "test-agent",
    agentId: testAgentId,
    sessionId: testAgentSessionId,
    message: testPrompt,
    timeoutSeconds: Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS ?? 600)
  });

  const parsedRealVerdict = openClawTestResult?.text.match(/(?:测试结果|判定)[：:]\s*(PASS|FAIL)/i);
  const realIssueCount = openClawTestResult?.text.match(/问题数[：:]\s*(\d+)/);
  const verdict =
    parsedRealVerdict?.[1]?.toUpperCase() === "PASS"
      ? "PASS"
      : parsedRealVerdict?.[1]?.toUpperCase() === "FAIL"
        ? "FAIL_RETRYABLE"
        : parsed.quality === "needs_fix" || !parsed.handoff
          ? "FAIL_RETRYABLE"
          : "PASS";
  const issueCount =
    verdict === "PASS" ? 0 : realIssueCount?.[1] ? Number(realIssueCount[1]) : 1;
  const requiredFixes =
    verdict === "PASS"
      ? []
      : openClawTestResult
        ? ["test-agent 判定未通过，请查看测试报告和返回文本。"]
        : ["Add a valid handoff object so the next stage can consume this output."];

  const reportPath = path.join(stageDir, `test-report-attempt-${input.attemptNo}.md`);
  const stateJsonPath = path.join(
    stateDir,
    `stage-${stage.stageIndex.toString().padStart(3, "0")}-${stageTypeToAgentType(
      stage.stageType
    )}-test.json`
  );
  const nextAction =
    verdict === "PASS"
      ? "continue_to_next_stage"
      : input.attemptNo >= stage.maxRetries
        ? "wait_for_human_decision"
        : "retry_previous_agent";
  const reportLines = [
    `### 判定：${verdict === "PASS" ? "PASS" : "FAIL"}`,
    `报告路径：${reportPath}`,
    `问题数：${issueCount}`,
    "",
    `Stage: ${stage.name}`,
    `Attempt: ${input.attemptNo}`,
    `Output artifact: ${input.outputArtifactId}`,
    `State JSON: ${stateJsonPath}`,
    "",
    verdict === "PASS"
      ? "All acceptance criteria are sufficiently satisfied for the mock pipeline."
      : [
          `Required fixes:\n${requiredFixes.map((fix) => `- ${fix}`).join("\n")}`,
          openClawTestResult ? `\nRaw test-agent output:\n${openClawTestResult.text}` : ""
        ].join("\n"),
    ""
  ];

  await writeFile(reportPath, reportLines.join("\n"), "utf8");
  const stateJson = {
    task_id: input.jobId,
    stage_number: stage.stageIndex,
    test_type: stageTypeToAgentType(stage.stageType),
    verdict: verdict === "PASS" ? "PASS" : "FAIL",
    issue_count: issueCount,
    retry_round: input.attemptNo,
    report_path: reportPath,
    tested_artifact_path: outputArtifact.uri,
    tested_summary_path: workLogPath,
    next_action: nextAction,
    created_at: nowIso()
  };
  await writeFile(stateJsonPath, `${JSON.stringify(stateJson, null, 2)}\n`, "utf8");

  const reportArtifact = await createArtifact({
    id: `${stage.id}-ART-TEST-${input.attemptNo.toString().padStart(2, "0")}`,
    jobId: input.jobId,
    stageId: stage.id,
    type: "test_report",
    title: `${stage.name} test report attempt ${input.attemptNo}`,
    content: reportLines.join("\n"),
    uri: reportPath,
    metadata: {
      verdict,
      issueCount,
      requiredFixes,
      testAgentSessionId,
      stateJsonPath,
      nextAction
    }
  });

  await createArtifact({
    id: `${stage.id}-ART-TEST-STATE-${input.attemptNo.toString().padStart(2, "0")}`,
    jobId: input.jobId,
    stageId: stage.id,
    type: "state_json",
    title: `${stage.name} test state attempt ${input.attemptNo}`,
    content: JSON.stringify(stateJson, null, 2),
    uri: stateJsonPath,
    metadata: {
      reportArtifactId: reportArtifact.id
    }
  });

  const reviewId = await saveTestReview({
    stageId: stage.id,
    attemptId: input.attemptId,
    attemptNo: input.attemptNo,
    testAgentId,
    testAgentSessionId,
    verdict,
    issueCount,
    reportArtifactId: reportArtifact.id,
    requiredFixes
  });

  await appendJobEvent(input.jobId, "stage.test_completed", {
    stageId: stage.id,
    attemptNo: input.attemptNo,
    verdict,
    issueCount,
    reportArtifactId: reportArtifact.id
  });

  const groupMessage =
    verdict === "PASS"
      ? null
      : await postGroupMessage({
          id: `${stage.id}-MSG-TEST-RESULT-${input.attemptNo.toString().padStart(2, "0")}`,
          jobId: input.jobId,
          stageId: stage.id,
          senderAgentId: testAgentId,
          mentionAgentId: stage.agentId,
          messageType: "test_fail_to_previous_agent",
          artifactId: reportArtifact.id,
          content: [
            `@${stage.agentId} 测试未通过，请根据报告重新跑本阶段。`,
            displayOnlyHandoffLine(stage.agentId, "返修"),
            "",
            `Job：${input.jobId}`,
            `阶段：${stage.stageIndex} / ${stage.stageType}`,
            `连续失败次数：${input.attemptNo}`,
            `报告 artifact：${reportArtifact.id}`,
            `报告路径：${reportPath}`,
            `状态 JSON：${stateJsonPath}`,
            "",
            ...requiredFixes.map((fix) => `- ${fix}`)
          ].join("\n")
        });

  return {
    reviewId,
    testAgentSessionId,
    verdict,
    issueCount,
    reportArtifactId: reportArtifact.id,
    reportPath,
    groupMessageId: groupMessage?.id ?? ""
  };
}

export async function runFinalTestAgent(input: {
  jobId: string;
  sourceArtifactId: string;
  routingMode: RoutingMode;
}): Promise<FinalQualityGateResult> {
  const [job, sourceArtifact] = await Promise.all([
    getJob(input.jobId),
    getArtifact(input.sourceArtifactId)
  ]);
  if (!job) {
    throw new Error(`Job not found: ${input.jobId}`);
  }

  const workdir = job.workdir ?? path.resolve(process.env.JOB_DATA_DIR ?? "data/jobs", input.jobId);
  const finalDir = path.join(workdir, "final");
  const stateDir = path.join(workdir, "state");
  await mkdir(finalDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  const testAgentId = "test-agent";
  const testAgentSessionId = `${job.sessionId}:${testAgentId}:final-${input.routingMode}`;
  const finalTestPrompt = [
    "Final quality gate.",
    `Job: ${input.jobId}`,
    `Routing mode: ${input.routingMode}`,
    `Source artifact: ${input.sourceArtifactId}`,
    `Source artifact path: ${sourceArtifact.uri ?? "none"}`,
    "",
    "Review the final candidate for correctness, completeness, safety, and usefulness.",
    "Return PASS if it is acceptable. Return FAIL with required fixes if it should not be delivered.",
    "",
    "Source artifact content:",
    compactMultiline(sourceArtifact.content ?? "", 6000)
  ].join("\n");

  const openClawTestResult = await runOpenClawAgentIdempotent({
    jobId: input.jobId,
    stageId: null,
    stageIndex: 0,
    attemptNo: 1,
    actionType: "final-test-agent",
    agentId: testAgentId,
    sessionId: testAgentSessionId,
    message: finalTestPrompt,
    timeoutSeconds: Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS ?? 600)
  });

  const parsedRealVerdict = openClawTestResult?.text.match(/(?:final verdict|verdict|判定|测试结果)[:：]\s*(PASS|FAIL)/i);
  const shouldForceFinalFailure = /force final fail|final quality fail|终检失败/i.test(job.rawPrompt);
  const verdict =
    parsedRealVerdict?.[1]?.toUpperCase() === "PASS"
      ? "PASS"
      : parsedRealVerdict?.[1]?.toUpperCase() === "FAIL" || shouldForceFinalFailure
        ? "FAIL_RETRYABLE"
        : "PASS";
  const issueCount = verdict === "PASS" ? 0 : 1;
  const requiredFixes =
    verdict === "PASS"
      ? []
      : openClawTestResult
        ? ["Final test-agent rejected the candidate. Inspect the final test report."]
        : ["Final quality gate was forced to fail by the request prompt."];

  const reportPath = path.join(finalDir, "final-test-report.md");
  const stateJsonPath = path.join(stateDir, "final-test-state.json");
  const reportLines = [
    `# Final Quality Gate`,
    "",
    `Verdict: ${verdict === "PASS" ? "PASS" : "FAIL"}`,
    `Job: ${input.jobId}`,
    `Routing mode: ${input.routingMode}`,
    `Source artifact: ${input.sourceArtifactId}`,
    `Issue count: ${issueCount}`,
    "",
    verdict === "PASS"
      ? "The final candidate passed the final quality gate."
      : [
          "Required fixes:",
          ...requiredFixes.map((fix) => `- ${fix}`),
          openClawTestResult ? `\nRaw test-agent output:\n${openClawTestResult.text}` : ""
        ].join("\n"),
    ""
  ];
  const stateJson = {
    task_id: input.jobId,
    routing_mode: input.routingMode,
    verdict: verdict === "PASS" ? "PASS" : "FAIL",
    issue_count: issueCount,
    source_artifact_id: input.sourceArtifactId,
    report_path: reportPath,
    next_action: verdict === "PASS" ? "finalize_job" : "wait_for_human_decision",
    created_at: nowIso()
  };

  await writeFile(reportPath, reportLines.join("\n"), "utf8");
  await writeFile(stateJsonPath, `${JSON.stringify(stateJson, null, 2)}\n`, "utf8");

  const reportArtifact = await createArtifact({
    id: `${input.jobId}-ART-FINAL-TEST-01`,
    jobId: input.jobId,
    type: "test_report",
    title: "Final quality gate report",
    content: reportLines.join("\n"),
    uri: reportPath,
    metadata: {
      routingMode: input.routingMode,
      verdict,
      issueCount,
      requiredFixes,
      sourceArtifactId: input.sourceArtifactId,
      testAgentSessionId,
      stateJsonPath
    }
  });

  await createArtifact({
    id: `${input.jobId}-ART-FINAL-TEST-STATE-01`,
    jobId: input.jobId,
    type: "state_json",
    title: "Final quality gate state",
    content: JSON.stringify(stateJson, null, 2),
    uri: stateJsonPath,
    metadata: {
      reportArtifactId: reportArtifact.id
    }
  });

  await appendJobEvent(
    input.jobId,
    "final.test_completed",
    {
      routingMode: input.routingMode,
      sourceArtifactId: input.sourceArtifactId,
      verdict,
      issueCount,
      reportArtifactId: reportArtifact.id
    },
    {
      actor: testAgentId,
      artifactId: reportArtifact.id
    }
  );

  const groupMessage = await postGroupMessage({
    id: `${input.jobId}-MSG-FINAL-TEST-01`,
    jobId: input.jobId,
    senderAgentId: testAgentId,
    mentionAgentId: "main-agent",
    messageType: verdict === "PASS" ? "final_test_pass" : "final_test_failed_waiting_for_user",
    artifactId: reportArtifact.id,
    content: [
      `@main-agent final quality gate ${verdict === "PASS" ? "passed" : "failed"}`,
      displayOnlyHandoffLine("main-agent", `mode=${input.routingMode}`),
      "",
      `Job: ${input.jobId}`,
      `Routing mode: ${input.routingMode}`,
      `Source artifact: ${input.sourceArtifactId}`,
      `Report artifact: ${reportArtifact.id}`,
      `Report path: ${reportPath}`,
      `Issue count: ${issueCount}`,
      "",
      ...requiredFixes.map((fix) => `- ${fix}`)
    ].join("\n")
  });

  return {
    reviewId: `${input.jobId}-FINAL-REVIEW-01`,
    testAgentSessionId,
    verdict,
    issueCount,
    reportArtifactId: reportArtifact.id,
    reportPath,
    groupMessageId: groupMessage.id
  };
}

export async function passStageAndHandoff(input: {
  jobId: string;
  stageId: string;
  outputArtifactId: string;
  reportArtifactId: string;
}) {
  await markStageCompleted(input.stageId);
  await setNextStageInput(input.stageId, input.outputArtifactId);
  const [stage, nextStage] = await Promise.all([getStage(input.stageId), getNextStage(input.stageId)]);
  const mentionAgentId = nextStage?.agentId ?? "main-agent";
  const messageType = nextStage ? "test_pass_to_next_agent" : "final_output";

  await postGroupMessage({
    id: `${input.stageId}-MSG-HANDOFF-PASS`,
    jobId: input.jobId,
    stageId: input.stageId,
    senderAgentId: "test-agent",
    mentionAgentId,
    messageType,
    artifactId: input.outputArtifactId,
    content: nextStage
      ? [
          `@${nextStage.agentId} 上一阶段测试通过，请继续下一步。`,
          displayOnlyHandoffLine(nextStage.agentId, "进入下一阶段"),
          "",
          `Job：${input.jobId}`,
          `上一阶段：${stage.stageIndex} / ${stage.name}`,
          `下一阶段：${nextStage.stageIndex} / ${nextStage.name}`,
          `输入 artifact：${input.outputArtifactId}`,
          `测试报告 artifact：${input.reportArtifactId}`
        ].join("\n")
      : [
          "@main-agent 最后阶段测试通过，请汇总最终结果。",
          displayOnlyHandoffLine("main-agent", "最终汇总"),
          "",
          `Job：${input.jobId}`,
          `最终输入 artifact：${input.outputArtifactId}`,
          `测试报告 artifact：${input.reportArtifactId}`
        ].join("\n")
  });

  await appendJobEvent(input.jobId, "stage.completed", {
    stageId: input.stageId,
    outputArtifactId: input.outputArtifactId
  });
}

export async function completeStageWithoutReview(input: {
  jobId: string;
  stageId: string;
  outputArtifactId: string;
  routingMode: RoutingMode;
  linkNextStage?: boolean;
  roundNo?: number;
}) {
  await markStageCompleted(input.stageId);
  if (input.linkNextStage) {
    await setNextStageInput(input.stageId, input.outputArtifactId);
  }

  await appendJobEvent(input.jobId, "stage.completed_without_review", {
    stageId: input.stageId,
    outputArtifactId: input.outputArtifactId,
    routingMode: input.routingMode,
    linkNextStage: input.linkNextStage ?? false,
    roundNo: input.roundNo ?? null
  });
}

export async function recordDiscussionRound(input: {
  jobId: string;
  roundNo: number;
  stageIds: string[];
}) {
  await appendJobEvent(input.jobId, "discussion.round_completed", {
    roundNo: input.roundNo,
    stageIds: input.stageIds
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactMultiline(value: string, maxLength = 2000) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength)}...` : compacted;
}

function parseArtifactSummary(artifact: ArtifactRecord | null): string {
  if (!artifact?.content) {
    return "";
  }

  try {
    const parsed = JSON.parse(artifact.content) as Record<string, unknown>;
    const summary = asString(parsed.summary);
    if (summary) {
      return summary;
    }
  } catch {
    // Fall back to plain text below.
  }

  return compactMultiline(artifact.content);
}

async function getArtifactOrNull(artifactId: string | null) {
  if (!artifactId) {
    return null;
  }

  try {
    return await getArtifact(artifactId);
  } catch {
    return null;
  }
}

async function getDiscussionOutputRows(events: AgentEventRecord[]) {
  const completedEvents = events.filter(
    (event) =>
      event.eventType === "stage.agent_completed" &&
      event.payload?.routingMode === "master_slave_discussion"
  );

  const rows = [];
  for (const event of completedEvents) {
    const artifactId = asString(event.payload?.outputArtifactId);
    const artifact = await getArtifactOrNull(artifactId);
    rows.push({
      seq: event.seq,
      stageId: event.stageId,
      agentId: asString(event.payload?.agentId) ?? event.actor,
      attemptNo: asNumber(event.payload?.attemptNo),
      artifactId,
      summary: parseArtifactSummary(artifact)
    });
  }

  return rows;
}

export async function mainAgentSynthesizeDiscussion(jobId: string) {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const [stages, events] = await Promise.all([getStagesForJob(jobId), getAgentEventsForJob(jobId)]);
  const discussionRows = await getDiscussionOutputRows(events);
  const roundEvents = events.filter((event) => event.eventType === "discussion.round_completed");
  const workdir = job.workdir ?? path.resolve(process.env.JOB_DATA_DIR ?? "data/jobs", jobId);
  const finalDir = path.join(workdir, "final");
  await mkdir(finalDir, { recursive: true });

  const discussionThread = discussionRows.map((row) =>
    [
      `Seq: ${row.seq}`,
      `Round: ${row.attemptNo ?? "unknown"}`,
      `Agent: ${row.agentId}`,
      `Stage: ${row.stageId ?? "unknown"}`,
      `Artifact: ${row.artifactId ?? "missing"}`,
      `Summary: ${row.summary || "No summary recorded."}`
    ].join("\n")
  );
  const prompt = [
    "You are main-agent. Synthesize the completed master_slave_discussion thread into the final answer.",
    "Use the agent event ledger as the source of truth. Preserve useful disagreements, final consensus, risks, and next steps.",
    "",
    `Job: ${jobId}`,
    `Original user request: ${job.rawPrompt}`,
    `Stages: ${stages.map((stage) => `${stage.stageIndex}:${stage.agentId}`).join(", ")}`,
    `Completed discussion rounds: ${roundEvents.length}`,
    "",
    "Discussion thread:",
    discussionThread.join("\n\n---\n\n")
  ].join("\n");

  const sessionId = `${job.sessionId}:main-agent:discussion-synthesis`;
  const openClawResult = await runOpenClawAgentIdempotent({
    jobId,
    stageId: null,
    stageIndex: 0,
    attemptNo: 1,
    actionType: "main-agent-synthesis",
    agentId: "main-agent",
    sessionId,
    message: prompt,
    timeoutSeconds: Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS ?? 600)
  });

  const synthesisBody =
    openClawResult?.text ??
    [
      `# ${jobId} Discussion Synthesis`,
      "",
      "main-agent synthesized the master_slave_discussion ledger.",
      "",
      `Rounds completed: ${roundEvents.length}`,
      `Stage outputs synthesized: ${discussionRows.length}`,
      "",
      "Discussion ledger summary:",
      ...discussionRows.map(
        (row) =>
          `- round ${row.attemptNo ?? "?"} ${row.agentId} (${row.artifactId ?? "no artifact"}): ${
            row.summary || "No summary recorded."
          }`
      )
    ].join("\n");
  const synthesisPath = path.join(finalDir, "discussion-synthesis.md");

  await writeFile(synthesisPath, synthesisBody, "utf8");
  const artifact = await createArtifact({
    id: `${jobId}-ART-DISCUSSION-SYNTHESIS`,
    jobId,
    type: "discussion_synthesis",
    title: "main-agent discussion synthesis",
    content: synthesisBody,
    uri: synthesisPath,
    metadata: {
      routingMode: "master_slave_discussion",
      roundCount: roundEvents.length,
      stageCount: stages.length,
      outputCount: discussionRows.length,
      sourceEventSeqs: discussionRows.map((row) => row.seq),
      agentSessionId: sessionId
    }
  });

  await appendJobEvent(
    jobId,
    "discussion.synthesized",
    {
      artifactId: artifact.id,
      synthesisPath,
      roundCount: roundEvents.length,
      outputCount: discussionRows.length
    },
    {
      actor: "main-agent",
      artifactId: artifact.id
    }
  );

  return {
    artifactId: artifact.id,
    synthesisPath,
    roundCount: roundEvents.length,
    outputCount: discussionRows.length
  };
}

export async function requestStageFix(input: {
  jobId: string;
  stageId: string;
  attemptNo: number;
  reportArtifactId: string;
}) {
  await markStageFixing(input.stageId);
  await appendJobEvent(input.jobId, "stage.fix_requested", {
    stageId: input.stageId,
    attemptNo: input.attemptNo,
    reportArtifactId: input.reportArtifactId
  });
}

export async function stopAfterConsecutiveFailures(input: {
  jobId: string;
  stageId: string;
  attemptNo: number;
  reportArtifactId: string;
}) {
  const stage = await getStage(input.stageId);
  await markStageWaitingForHuman(input.stageId);

  await postGroupMessage({
    id: `${input.stageId}-MSG-WAITING-FOR-USER`,
    jobId: input.jobId,
    stageId: input.stageId,
    senderAgentId: "test-agent",
    mentionAgentId: "main-agent",
    messageType: "test_failed_waiting_for_user",
    artifactId: input.reportArtifactId,
    content: [
      "@main-agent 连续 3 次测试未通过，测试停止，等待用户决策。",
      displayOnlyHandoffLine("main-agent", "等待人工决策"),
      "",
      `Job：${input.jobId}`,
      `阶段：${stage.stageIndex} / ${stage.name}`,
      `失败 Agent：${stage.agentId}`,
      `连续失败次数：${input.attemptNo}`,
      `最近测试报告 artifact：${input.reportArtifactId}`
    ].join("\n")
  });

  await markJobWaitingForHuman(input.jobId, `Stage ${stage.id} failed ${input.attemptNo} consecutive tests`);
}

export async function finalizeJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const stages = await getStagesForJob(jobId);
  const workdir = job.workdir ?? path.resolve(process.env.JOB_DATA_DIR ?? "data/jobs", jobId);
  const finalPath = path.join(workdir, "final", "final-answer.md");
  const discussionSynthesis =
    job.routingMode === "master_slave_discussion"
      ? await getArtifactOrNull(`${jobId}-ART-DISCUSSION-SYNTHESIS`)
      : null;
  const finalOutput = [
    `# ${jobId} Final Output`,
    "",
    "Mock pipeline completed successfully.",
    "",
    `Routing mode: ${job.routingMode ?? DEFAULT_ROUTING_MODE}`,
    "",
    "Completed stages:",
    ...stages.map((stage) => `- ${stage.stageIndex}. ${stage.name} (${stage.agentId})`),
    "",
    discussionSynthesis
      ? ["Main-agent discussion synthesis:", "", discussionSynthesis.content ?? ""].join("\n")
      : "No dedicated discussion synthesis artifact was required for this routing mode.",
    "",
    "Final owner: main-agent summarized the completed stage outputs.",
    "Next milestone: replace mock activities with real OpenClaw agent calls.",
    ""
  ].join("\n");

  await writeFile(finalPath, finalOutput, "utf8");
  const artifact = await createArtifact({
    id: `${jobId}-ART-FINAL`,
    jobId,
    type: "final_output",
    title: "Final answer",
    content: finalOutput,
    uri: finalPath
  });

  const finalized = await setJobFinalOutput(jobId, finalOutput);
  if (!finalized) {
    return {
      finalOutput: "",
      finalArtifactId: artifact.id,
      finalPath
    };
  }

  await postGroupMessage({
    id: `${jobId}-MSG-FINAL`,
    jobId,
    senderAgentId: "main-agent",
    mentionAgentId: null,
    messageType: "final_output",
    artifactId: artifact.id,
    content: [
      `任务完成：${jobId}`,
      displayOnlyHandoffLine(null),
      "",
      `Routing mode: ${job.routingMode ?? DEFAULT_ROUTING_MODE}`,
      "All configured stages completed and the final result has been generated.",
      `最终 artifact：${artifact.id}`,
      `最终路径：${finalPath}`
    ].join("\n")
  });
  await appendJobEvent(jobId, "final.artifact_created", {
    artifactId: artifact.id,
    finalPath
  });

  const experience = await createExperienceCandidate({
    id: `${jobId}-EXP-ROUTING-OUTCOME`,
    sourceJobId: jobId,
    kind: "routing_outcome",
    scope: "routing_mode",
    scopeKey: job.routingMode ?? DEFAULT_ROUTING_MODE,
    summary: `Routing mode ${job.routingMode ?? DEFAULT_ROUTING_MODE} completed a job successfully and is ready for user review before reuse.`,
    evidence: [
      {
        type: "job_succeeded",
        jobId,
        routingMode: job.routingMode ?? DEFAULT_ROUTING_MODE,
        finalArtifactId: artifact.id
      },
      {
        type: "completed_stages",
        stages: stages.map((stage) => ({
          stageId: stage.id,
          stageIndex: stage.stageIndex,
          agentId: stage.agentId,
          status: stage.status
        }))
      }
    ],
    confidence: 0.55,
    metadata: {
      extractionVersion: "routing-outcome.v1",
      requiresHumanReview: true
    }
  });
  await appendJobEvent(
    jobId,
    "experience.candidate_created",
    {
      experienceId: experience.id,
      kind: experience.kind,
      scope: experience.scope,
      scopeKey: experience.scopeKey,
      confidence: experience.confidence
    },
    {
      actor: "memory-agent",
      artifactId: artifact.id
    }
  );

  await archiveJobSession({
    jobId,
    retentionDays: Number(process.env.SESSION_RETENTION_DAYS ?? 30),
    reason: "job_completed"
  });

  return {
    finalOutput,
    finalArtifactId: artifact.id,
    finalPath
  };
}
