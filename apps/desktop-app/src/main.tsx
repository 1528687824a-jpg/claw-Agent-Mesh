import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Gauge,
  History,
  KeyRound,
  Languages,
  LockKeyhole,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  X
} from "lucide-react";
import {
  adoptExperience,
  approveToolApproval,
  cancelJob,
  createJob,
  getHealth,
  getJob,
  getJobTimeline,
  listExperiences,
  listJobs,
  listToolApprovals,
  rejectExperience,
  rejectToolApproval,
  type ExperienceListResponse,
  type ExperienceRecord,
  type ExperienceStatus,
  type JobRecord,
  type JobStatus,
  type JobTimeline,
  type ListJobsResponse,
  type RoutingMode,
  type ToolApprovalRecord
} from "./api";
import { FirstRunPanel, type FirstRunFlow } from "./firstRun";
import { HoneycombLogo } from "./brand";
import "./styles.css";

type ApiState = "checking" | "online" | "offline";
type JobStatusFilter = "all" | "running" | "waiting_for_human" | "cancelled";
type JobTimeFilter = "all" | "24h" | "7d" | "custom";
type Language = "en" | "zh";
type AppView = "dashboard" | "setup" | "jobs" | "approvals" | "agents" | "models" | "memory" | "settings";
type TourAnchor = "activity" | "dashboard" | "setup" | "jobs" | "settings";

type SecurityRecord = {
  passwordSalt: string;
  passwordHash: string;
  recoveryQuestion?: string;
  recoveryQuestionId?: RecoveryQuestionId;
  recoverySalt?: string;
  recoveryHash?: string;
  updatedAt: string;
};

type RecoveryQuestionId = "first_project" | "favorite_place" | "first_tool" | "mentor_name" | "memorable_date";

type FirstRunPreview = {
  provider?: {
    providerName?: string;
    baseUrl?: string;
    model?: string;
    apiKeyConfigured?: boolean;
  };
  profile?: {
    supervisorName?: string;
  };
};

type SupervisorPermissionKey =
  | "readWorkspace"
  | "writeWorkspace"
  | "runCommands"
  | "networkAccess"
  | "mcpTools";

type SupervisorWorkbenchConfig = {
  workspacePath: string;
  permissions: Record<SupervisorPermissionKey, boolean>;
  skills: string;
  mcpServers: string;
  updatedAt: string;
};

type WorkbenchStepState = "done" | "active" | "pending" | "blocked";

type WorkbenchPlanStep = {
  title: string;
  body: string;
  state: WorkbenchStepState;
};

type AgentModelConfig = {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  verifiedAt?: string;
  appliedAt?: string;
};

type AgentConfigDraft = AgentModelConfig;

type ProviderConnectionResult = {
  ok: boolean;
  message?: string;
  openclawManifestPath?: string;
};

type RoutingFlowStep = {
  title: string;
  body: string;
};

const routingModes: RoutingMode[] = [
  "supervisor_pipeline",
  "pipeline",
  "classic_master_slave",
  "master_slave_discussion"
];

const routingModeLabels: Record<Language, Record<RoutingMode, string>> = {
  en: {
    supervisor_pipeline: "Supervisor Pipeline",
    pipeline: "Sequential Pipeline",
    classic_master_slave: "Classic Lead + Workers",
    master_slave_discussion: "Lead + Team Discussion"
  },
  zh: {
    supervisor_pipeline: "监督者流水线",
    pipeline: "顺序流水线",
    classic_master_slave: "经典主从协作",
    master_slave_discussion: "主从讨论协作"
  }
};

const routingModeFlows: Record<Language, Record<RoutingMode, RoutingFlowStep[]>> = {
  en: {
    supervisor_pipeline: [
      { title: "Panel agent reads the task", body: "The supervisor clarifies the goal, risk, quality bar, and whether tools or files are needed." },
      { title: "Planner creates stages", body: "The main agent turns the task into ordered stages and assigns suitable specialist agents." },
      { title: "Specialists execute", body: "Research, writing, image, video, or other workers run their own stage with scoped instructions." },
      { title: "Supervisor gate", body: "A test or supervisor agent checks the result against acceptance criteria before final synthesis." },
      { title: "Final answer", body: "The main agent merges approved work and reports what was done, what changed, and what remains." }
    ],
    pipeline: [
      { title: "Task intake", body: "The panel agent identifies a clear step-by-step production path." },
      { title: "Stage 1", body: "The first specialist produces the upstream material needed by the next specialist." },
      { title: "Stage 2", body: "The next specialist continues from the previous artifact instead of restarting." },
      { title: "Stage 3", body: "Later stages refine, package, or prepare the final deliverable." },
      { title: "Final check", body: "The result is checked once at the end before delivery." }
    ],
    classic_master_slave: [
      { title: "Lead receives the task", body: "The main agent decides what can be delegated and what must remain centralized." },
      { title: "Workers run in parallel", body: "Several agents handle independent subtasks such as research, drafting, or review." },
      { title: "Lead collects results", body: "The main agent compares worker outputs and resolves conflicts or missing parts." },
      { title: "Review pass", body: "The reviewer checks whether the combined result meets the user's request." },
      { title: "Delivery", body: "The lead returns one coherent final result." }
    ],
    master_slave_discussion: [
      { title: "Lead frames the question", body: "The main agent turns an ambiguous task into a discussion agenda." },
      { title: "Round discussion", body: "Specialist agents contribute different viewpoints, objections, and alternatives." },
      { title: "Second pass", body: "Agents react to each other and refine weak assumptions." },
      { title: "Synthesis", body: "The lead agent merges the discussion into a practical recommendation." },
      { title: "Quality check", body: "The result is checked for gaps, contradictions, and next actions." }
    ]
  },
  zh: {
    supervisor_pipeline: [
      { title: "面板 agent 读取任务", body: "主管先判断目标、风险、质量标准，以及是否需要工具或本地文件。" },
      { title: "主控 agent 制定阶段", body: "主控把任务拆成有顺序的阶段，并分配合适的专业 agent。" },
      { title: "专业 agent 执行", body: "研究、写作、图像、视频等 agent 按自己的阶段产出内容。" },
      { title: "监督关卡", body: "质检或监督 agent 按验收标准检查结果，不通过就要求返工。" },
      { title: "最终整合", body: "主控整合通过检查的内容，给出最终结果和剩余风险。" }
    ],
    pipeline: [
      { title: "任务进入", body: "面板 agent 判断这是清晰的分步骤生产任务。" },
      { title: "第一阶段", body: "第一个专业 agent 产出下游需要的基础材料。" },
      { title: "第二阶段", body: "后续 agent 继承上一阶段产物继续处理，而不是重新开始。" },
      { title: "第三阶段", body: "后续阶段继续细化、包装或准备最终交付物。" },
      { title: "最终检查", body: "所有阶段完成后统一做一次质量检查，再交付给用户。" }
    ],
    classic_master_slave: [
      { title: "主控接收任务", body: "主控 agent 判断哪些部分可以分派，哪些必须由自己集中处理。" },
      { title: "子 agent 并行工作", body: "多个专业 agent 分别处理研究、草稿、校对等相互独立的子任务。" },
      { title: "主控收集结果", body: "主控对比不同子 agent 的结果，解决冲突和缺口。" },
      { title: "评审通过", body: "评审 agent 检查组合结果是否符合用户请求。" },
      { title: "统一交付", body: "主控输出一份连贯的最终结果。" }
    ],
    master_slave_discussion: [
      { title: "主控定义议题", body: "主控把模糊任务整理成可讨论的问题和判断标准。" },
      { title: "多 agent 讨论", body: "不同专业 agent 给出观点、反对意见和备选方案。" },
      { title: "第二轮校正", body: "各 agent 根据彼此观点修正弱假设，补充遗漏信息。" },
      { title: "主控综合", body: "主控把讨论结果整理成可执行建议。" },
      { title: "质量检查", body: "最终检查结论是否有矛盾、遗漏和下一步行动。" }
    ]
  }
};

const cancellableStatuses: JobStatus[] = [
  "created",
  "queued",
  "planning",
  "running",
  "testing",
  "fixing",
  "waiting_for_human"
];

const jobStatusFilters: Array<{ id: JobStatusFilter; status?: JobStatus }> = [
  { id: "all" },
  { id: "running", status: "running" },
  { id: "waiting_for_human", status: "waiting_for_human" },
  { id: "cancelled", status: "cancelled" }
];

const jobTimeFilters: Array<{ id: JobTimeFilter }> = [
  { id: "all" },
  { id: "24h" },
  { id: "7d" },
  { id: "custom" }
];

const languageOptions: Array<{ id: Language; label: string }> = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" }
];

const supervisorPermissionKeys: SupervisorPermissionKey[] = [
  "readWorkspace",
  "writeWorkspace",
  "runCommands",
  "networkAccess",
  "mcpTools"
];

const defaultSupervisorPermissions: Record<SupervisorPermissionKey, boolean> = {
  readWorkspace: true,
  writeWorkspace: false,
  runCommands: false,
  networkAccess: true,
  mcpTools: false
};

const recoveryQuestionOptions: Record<Language, Array<{ id: RecoveryQuestionId; label: string }>> = {
  en: [
    { id: "first_project", label: "What was the first project you used this panel for?" },
    { id: "favorite_place", label: "What city or place do you associate with your work?" },
    { id: "first_tool", label: "What was the first work tool you used often?" },
    { id: "mentor_name", label: "What is the name of a mentor or teacher you remember?" },
    { id: "memorable_date", label: "What date is meaningful to your work?" }
  ],
  zh: [
    { id: "first_project", label: "你第一次准备用这个面板处理什么项目？" },
    { id: "favorite_place", label: "哪个城市或地点最能代表你的工作？" },
    { id: "first_tool", label: "你最早经常使用的工作工具是什么？" },
    { id: "mentor_name", label: "你记得的一位老师或导师叫什么？" },
    { id: "memorable_date", label: "对你的工作有意义的日期是哪一天？" }
  ]
};

const translations = {
  en: {
    appName: "honeycomb",
    subtitle: "Local multi-agent control desk",
    apiOnline: "OpenClaw online",
    apiOffline: "OpenClaw offline",
    apiChecking: "Checking OpenClaw",
    refresh: "Refresh",
    languageLabel: "Language",
    setupTab: "First Run",
    consoleTab: "Console",
    dashboard: "Dashboard",
    jobsView: "Jobs",
    approvalsView: "Approvals",
    agentsView: "Agents",
    modelsView: "Models",
    memoryView: "Memory",
    settingsView: "Settings",
    startSetup: "Start First Run",
    openJobs: "Open Jobs",
    newJob: "New Job",
    routing: "Routing",
    budget: "Budget",
    startJob: "Start Job",
    jobs: "Jobs",
    jobStatusFilter: "Job status filter",
    jobTimeFilter: "Job created time filter",
    searchPrompts: "Search prompts",
    searchPromptsAria: "Search job prompts",
    since: "Since",
    until: "Until",
    noJobsMatch: "No jobs match.",
    loadMore: "Load More",
    noJobSelected: "No job selected",
    cancel: "Cancel",
    cancelled: "Cancelled",
    status: "Status",
    created: "Created",
    timeline: "Timeline",
    noJobLoaded: "No job loaded.",
    latestItems: "latest items",
    complete: "complete",
    noTimelineEvents: "No timeline events.",
    approvalQueueTitle: "Tool approval queue",
    approvalQueueHint: "Review higher-risk tool requests before agents write files, run commands, or use external tools.",
    pendingApprovals: "Pending approvals",
    noPendingApprovals: "No pending approvals.",
    approvalRisk: "Risk",
    approvalTool: "Tool",
    approvalAction: "Action",
    approvalTarget: "Target",
    approvalCommand: "Command",
    approvalReason: "Reason",
    approvalRequestedBy: "Requested by",
    approve: "Approve",
    reject: "Reject",
    approvalApproved: "Approval granted.",
    approvalRejected: "Approval rejected.",
    approvalLoadFailed: "Could not load approvals.",
    approvalDecisionFailed: "Could not update approval.",
    runningJobs: "Running jobs",
    totalJobs: "Total jobs",
    latestJob: "Latest job",
    noLatestJob: "No job yet",
    gatewayPanel: "Gateway",
    gatewayHint: "Backend status and local API address",
    currentModel: "Planner model",
    modelHint: "Configured model provider",
    agentHint: "Agent framework",
    memoryHint: "Prompts and experience memory",
    settingsHint: "Security, language, and local preferences",
    securityTitle: "Security",
    securityIntro: "Set a local panel password and a recovery question.",
    securityConfiguredIntro: "Verify the current password before changing the password or recovery question.",
    panelPassword: "Panel password",
    currentPassword: "Current password",
    password: "Password",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    recoveryQuestion: "Recovery question",
    changeRecoveryQuestion: "Change recovery question",
    recoveryQuestionOther: "Other",
    customRecoveryQuestion: "Custom recovery question",
    recoveryAnswer: "Recovery answer",
    saveSecurity: "Save security",
    savePassword: "Confirm",
    securitySaved: "Security settings saved.",
    securityPasswordSaved: "Security settings updated.",
    passwordMissing: "Add a new password.",
    currentPasswordMissing: "Enter the current password.",
    currentPasswordFailed: "Current password did not match.",
    noSecurityChanges: "Add a new password or change the recovery question.",
    cancelModify: "Cancel modification",
    cancelPassword: "Cancel local password",
    passwordCancelled: "Local panel password cancelled.",
    recoveryUnavailable: "No recovery question is configured.",
    resetTitle: "Reset",
    resetIntro: "Re-enter only the setup section you need without repeating the whole onboarding flow.",
    resetPanelAgent: "Panel agent",
    resetPanelAgentHint: "Rename it and reconnect model/API key.",
    resetWorkProfile: "Profession",
    resetWorkProfileHint: "Redo the work interview only.",
    smartRouting: "Smart routing",
    smartRoutingHint: "The panel agent will analyze the task and choose an orchestration mode.",
    modelsFlowHint: "Choose a mode to inspect how work moves through agents.",
    routingFlow: "Workflow",
    unconfigured: "Not configured",
    configureModelKey: "Configure model/key",
    agentConfigTitle: "Agent model setup",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "Model",
    apiKey: "API Key",
    saveAgentConfig: "Save configuration",
    cancelConfig: "Cancel",
    agentConfigSaved: "Agent model verified and written to the local OpenClaw config package.",
    agentConfigSaving: "Verifying model connection...",
    agentConfigVerifyFailed: "Could not verify the model connection. Check the model and API Key, then retry.",
    agentConfigMissing: "Add a model and API key before saving.",
    agentConfigured: "This agent has its own model/key configured.",
    panelAgentConfigured: "Uses the configured panel model.",
    specialistNeedsKey: "Needs its own model/key before this agent can run independently.",
    capabilityTitle: "Supervisor workbench",
    capabilityIntro: "These panels turn Honeycomb from a launcher into a control desk for a local multi-agent team.",
    capabilityItems: [
      { title: "Runtime config", body: "Inspect OpenClaw status, model provider, and local backend readiness before assigning work.", status: "Live" },
      { title: "Streaming progress", body: "Surface running jobs and timeline events as the supervisor agent delegates work.", status: "Live" },
      { title: "Plan and Todo", body: "Keep task stages visible so long jobs can be tracked and resumed.", status: "Next" },
      { title: "Project workspace", body: "Bind tasks to local folders, files, and branch context for safer handoffs.", status: "Next" },
      { title: "Permission control", body: "Make tool and file access explicit before agents perform higher-risk actions.", status: "Next" },
      { title: "Skills and MCP", body: "Expose reusable tools that specialist agents can request through the supervisor.", status: "Next" }
    ],
    workbenchRuntime: "Runtime config",
    workbenchStreaming: "Streaming progress",
    workbenchPlan: "Plan and Todo",
    workbenchWorkspace: "Project workspace",
    workbenchPermissions: "Permission control",
    workbenchSkills: "Skills and MCP",
    workbenchLive: "Live",
    workbenchLocal: "Local",
    workbenchStored: "Saved",
    workbenchLatestJob: "Tracked job",
    workbenchNoJob: "No job yet",
    workbenchTimelineItems: "Timeline events",
    workbenchWorkspaceLabel: "Workspace path",
    workbenchWorkspacePlaceholder: "For example: C:\\Users\\you\\Projects\\campaign",
    workbenchSave: "Save workbench config",
    workbenchSaved: "Workbench config saved locally.",
    workbenchSkillsLabel: "Available skills",
    workbenchMcpLabel: "MCP servers",
    workbenchSkillsPlaceholder: "For example: writing, image, video, review",
    workbenchMcpPlaceholder: "For example: filesystem, git, browser",
    workbenchPermissionLabels: {
      readWorkspace: "Read workspace files",
      writeWorkspace: "Write workspace files",
      runCommands: "Run local commands",
      networkAccess: "Use network access",
      mcpTools: "Use MCP tools"
    },
    passwordMismatch: "Passwords do not match.",
    securityMissing: "Add a password and recovery answer.",
    lockTitle: "honeycomb",
    lockSubtitle: "Enter the local panel password.",
    unlock: "Unlock",
    forgotPassword: "Forgot password",
    usePassword: "Use password",
    recoveryFailed: "Recovery answer did not match.",
    unlockFailed: "Password did not match.",
    tourSkip: "Skip",
    tourNext: "Next",
    tourDone: "Done",
    tourProgress: "Step",
    tourSteps: [
      {
        anchor: "activity",
        title: "Left activity bar",
        body: "Switch between the dashboard, first-run setup, jobs, agents, models, memory, and settings."
      },
      {
        anchor: "dashboard",
        title: "Dashboard",
        body: "Check gateway status, job health, current model, and the next useful action from the first screen."
      },
      {
        anchor: "jobs",
        title: "Jobs and timeline",
        body: "Create jobs, choose a routing mode, inspect messages, and cancel runs when needed."
      },
      {
        anchor: "settings",
        title: "Settings",
        body: "The lower-left settings button opens security, language, and local preferences."
      }
    ],
    navGroups: {
      operate: "Operate",
      build: "Build",
      system: "System"
    },
    statusFilters: {
      all: "All",
      running: "Running",
      waiting_for_human: "Waiting",
      cancelled: "Cancelled"
    },
    timeFilters: {
      all: "All Time",
      "24h": "24h",
      "7d": "7d",
      custom: "Custom"
    },
    statuses: {
      created: "created",
      queued: "queued",
      planning: "planning",
      running: "running",
      testing: "testing",
      fixing: "fixing",
      waiting_for_human: "waiting",
      succeeded: "succeeded",
      failed: "failed",
      cancelled: "cancelled"
    },
    sources: {
      job_event: "job event",
      agent_event: "agent event",
      group_message: "group message",
      stage_attempt: "stage attempt",
      test_review: "test review",
      artifact: "artifact"
    }
  },
  zh: {
    appName: "honeycomb",
    subtitle: "本地多 Agent 操作台",
    apiOnline: "OpenClaw 在线",
    apiOffline: "OpenClaw 离线",
    apiChecking: "正在检查 OpenClaw",
    refresh: "刷新",
    languageLabel: "语言",
    setupTab: "首次启动",
    consoleTab: "控制台",
    dashboard: "仪表盘",
    jobsView: "任务",
    approvalsView: "审批",
    agentsView: "Agent",
    modelsView: "模型",
    memoryView: "记忆",
    settingsView: "设置",
    startSetup: "开始首次启动",
    openJobs: "打开任务",
    newJob: "新任务",
    routing: "编排模式",
    budget: "预算",
    startJob: "启动任务",
    jobs: "任务",
    jobStatusFilter: "任务状态筛选",
    jobTimeFilter: "任务创建时间筛选",
    searchPrompts: "搜索任务提示词",
    searchPromptsAria: "搜索任务提示词",
    since: "开始",
    until: "结束",
    noJobsMatch: "没有匹配的任务。",
    loadMore: "加载更多",
    noJobSelected: "未选择任务",
    cancel: "取消",
    cancelled: "已取消",
    status: "状态",
    created: "创建时间",
    timeline: "时间线",
    noJobLoaded: "没有加载任务。",
    latestItems: "最新事件",
    complete: "完整",
    noTimelineEvents: "没有时间线事件。",
    approvalQueueTitle: "工具审批队列",
    approvalQueueHint: "在 agent 写文件、运行命令或调用外部工具前，先由你确认高风险请求。",
    pendingApprovals: "待审批",
    noPendingApprovals: "当前没有待审批请求。",
    approvalRisk: "风险",
    approvalTool: "工具",
    approvalAction: "动作",
    approvalTarget: "目标",
    approvalCommand: "命令",
    approvalReason: "原因",
    approvalRequestedBy: "发起者",
    approve: "批准",
    reject: "拒绝",
    approvalApproved: "已批准该请求。",
    approvalRejected: "已拒绝该请求。",
    approvalLoadFailed: "无法加载审批队列。",
    approvalDecisionFailed: "无法更新审批状态。",
    runningJobs: "运行中任务",
    totalJobs: "任务总数",
    latestJob: "最近任务",
    noLatestJob: "还没有任务",
    gatewayPanel: "Gateway",
    gatewayHint: "后端状态和本地 API 地址",
    currentModel: "Planner 模型",
    modelHint: "已配置的模型服务",
    agentHint: "Agent 框架",
    memoryHint: "提示词和经验记忆",
    settingsHint: "安全、语言和本地偏好",
    securityTitle: "安全设置",
    securityIntro: "设置本地面板密码和密保问题。",
    securityConfiguredIntro: "修改密码或密保问题前，请先验证原密码。",
    panelPassword: "面板密码",
    currentPassword: "原密码",
    password: "管理密码",
    newPassword: "新密码",
    confirmPassword: "确认密码",
    recoveryQuestion: "密保问题",
    changeRecoveryQuestion: "修改密保问题",
    recoveryQuestionOther: "其他",
    customRecoveryQuestion: "自定义密保问题",
    recoveryAnswer: "密保答案",
    saveSecurity: "保存安全设置",
    savePassword: "确认",
    securitySaved: "安全设置已保存。",
    securityPasswordSaved: "安全设置已修改。",
    passwordMissing: "请填写新密码。",
    currentPasswordMissing: "请先输入原密码。",
    currentPasswordFailed: "原密码不正确。",
    noSecurityChanges: "请填写新密码，或修改密保问题。",
    cancelModify: "取消修改",
    cancelPassword: "取消本地面板密码",
    passwordCancelled: "本地面板密码已取消。",
    recoveryUnavailable: "当前没有配置密保问题。",
    resetTitle: "重新设置",
    resetIntro: "只重新接入你需要修改的部分，不必重复完整首次配置。",
    resetPanelAgent: "重新设置你的面板agent",
    resetPanelAgentHint: "重新命名主管 agent，并重新配置模型和 API Key。",
    resetWorkProfile: "重新设置你的职业",
    resetWorkProfileHint: "只重新回答职业访谈，不改变面板 agent 和模型 Key。",
    smartRouting: "智能编排",
    smartRoutingHint: "面板 agent 会先分析你的任务，再自动选择适合的编排模式。",
    modelsFlowHint: "选择一个编排模式，查看任务会如何在 agent 之间流转。",
    routingFlow: "工作流程",
    unconfigured: "未配置",
    configureModelKey: "配置模型与 Key",
    agentConfigTitle: "Agent 模型配置",
    provider: "模型服务商",
    baseUrl: "接口地址",
    model: "模型",
    apiKey: "API Key",
    saveAgentConfig: "保存配置",
    cancelConfig: "取消",
    agentConfigSaved: "Agent 模型已验证，并写入 OpenClaw 本地配置包。",
    agentConfigSaving: "正在验证模型连接...",
    agentConfigVerifyFailed: "无法验证模型连接，请检查模型和 API Key 后重试。",
    agentConfigMissing: "请填写模型和 API Key 后保存。",
    agentConfigured: "这个 agent 已单独配置模型与 Key。",
    panelAgentConfigured: "使用首次启动时配置的面板模型。",
    specialistNeedsKey: "这个 agent 需要单独配置模型与 Key 后，才能独立参与任务。",
    capabilityTitle: "主管工作台",
    capabilityIntro: "这些面板把 Honeycomb 从启动器变成主管 agent 管理本地多 Agent 团队的操作台。",
    capabilityItems: [
      { title: "运行时配置", body: "先看 OpenClaw 状态、模型服务和本地后端是否可用，再分配任务。", status: "已接入" },
      { title: "流式反馈", body: "把运行中的任务和时间线事件持续显示出来，让主管 agent 的分工过程可见。", status: "已接入" },
      { title: "计划与 Todo", body: "把长任务拆成可跟踪阶段，方便暂停、继续和复盘。", status: "下一步" },
      { title: "项目工作区", body: "把任务绑定到本地目录、文件和分支上下文，减少 agent 交接误差。", status: "下一步" },
      { title: "权限控制", body: "在 agent 执行高风险工具或文件操作前，明确权限边界。", status: "下一步" },
      { title: "Skills 与 MCP", body: "把常用工具和技能变成专业 agent 可申请调用的能力。", status: "下一步" }
    ],
    workbenchRuntime: "运行时配置",
    workbenchStreaming: "流式反馈",
    workbenchPlan: "计划与 Todo",
    workbenchWorkspace: "项目工作区",
    workbenchPermissions: "权限控制",
    workbenchSkills: "Skills 与 MCP",
    workbenchLive: "实时",
    workbenchLocal: "本地",
    workbenchStored: "已保存",
    workbenchLatestJob: "跟踪任务",
    workbenchNoJob: "还没有任务",
    workbenchTimelineItems: "时间线事件",
    workbenchWorkspaceLabel: "工作区路径",
    workbenchWorkspacePlaceholder: "例如：C:\\Users\\你\\Projects\\农业方案",
    workbenchSave: "保存工作台配置",
    workbenchSaved: "工作台配置已保存在本地。",
    workbenchSkillsLabel: "可用技能",
    workbenchMcpLabel: "MCP 服务",
    workbenchSkillsPlaceholder: "例如：写作、图像、视频、评审",
    workbenchMcpPlaceholder: "例如：filesystem、git、browser",
    workbenchPermissionLabels: {
      readWorkspace: "读取工作区文件",
      writeWorkspace: "写入工作区文件",
      runCommands: "运行本地命令",
      networkAccess: "使用网络访问",
      mcpTools: "调用 MCP 工具"
    },
    passwordMismatch: "两次密码不一致。",
    securityMissing: "请填写密码和密保答案。",
    lockTitle: "honeycomb",
    lockSubtitle: "请输入本地面板密码。",
    unlock: "解锁",
    forgotPassword: "忘记密码",
    usePassword: "使用密码",
    recoveryFailed: "密保答案不匹配。",
    unlockFailed: "密码不匹配。",
    tourSkip: "跳过",
    tourNext: "下一步",
    tourDone: "完成",
    tourProgress: "步骤",
    tourSteps: [
      {
        anchor: "activity",
        title: "左侧功能栏",
        body: "在仪表盘、首次启动、任务、Agent、模型、记忆和设置之间切换。"
      },
      {
        anchor: "dashboard",
        title: "仪表盘",
        body: "第一屏查看 Gateway 状态、任务健康度、当前模型和下一步动作。"
      },
      {
        anchor: "jobs",
        title: "任务和时间线",
        body: "创建任务、选择编排模式、查看消息时间线，并在需要时取消运行。"
      },
      {
        anchor: "settings",
        title: "设置",
        body: "左下角设置用于管理安全、语言和本地偏好。"
      }
    ],
    navGroups: {
      operate: "运行",
      build: "构建",
      system: "系统"
    },
    statusFilters: {
      all: "全部",
      running: "运行中",
      waiting_for_human: "等待",
      cancelled: "已取消"
    },
    timeFilters: {
      all: "全部时间",
      "24h": "24 小时",
      "7d": "7 天",
      custom: "自定义"
    },
    statuses: {
      created: "已创建",
      queued: "排队中",
      planning: "规划中",
      running: "运行中",
      testing: "测试中",
      fixing: "修复中",
      waiting_for_human: "等待人工",
      succeeded: "已成功",
      failed: "已失败",
      cancelled: "已取消"
    },
    sources: {
      job_event: "任务事件",
      agent_event: "Agent 事件",
      group_message: "群消息",
      stage_attempt: "阶段尝试",
      test_review: "测试评审",
      artifact: "产物"
    }
  }
} as const;

function getInitialLanguage(): Language {
  const queryLanguage = new URLSearchParams(window.location.search).get("lang");
  if (queryLanguage === "zh" || queryLanguage === "en") {
    return queryLanguage;
  }
  const storedLanguage = window.localStorage.getItem("agentOpenClaw.language");
  return storedLanguage === "zh" ? "zh" : "en";
}

function getInitialView(): AppView {
  const storedView = window.localStorage.getItem("agentOpenClaw.activeView");
  const setupAlreadyComplete =
    window.localStorage.getItem("honeycomb.setupCompleted") === "true" ||
    new URLSearchParams(window.location.search).get("skipOnboarding") === "true";
  if (storedView === "console") return "jobs";
  if (storedView === "setup" && setupAlreadyComplete) return "dashboard";
  if (
    storedView === "dashboard" ||
    storedView === "setup" ||
    storedView === "jobs" ||
    storedView === "approvals" ||
    storedView === "agents" ||
    storedView === "models" ||
    storedView === "memory" ||
    storedView === "settings"
  ) {
    return storedView;
  }
  return "dashboard";
}

function formatTime(value: string | null | undefined, language: Language) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function compactEventType(value: string) {
  return value.replace(/^job\./, "").replace(/^stage\./, "").replace(/^group\./, "");
}

function isCancellable(job: JobRecord | null) {
  return job ? cancellableStatuses.includes(job.status) : false;
}

function statusTone(status: JobStatus) {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "waiting_for_human") return "warn";
  return "active";
}

function riskTone(riskLevel: ToolApprovalRecord["riskLevel"]) {
  if (riskLevel === "critical" || riskLevel === "high") return "danger";
  if (riskLevel === "medium") return "warn";
  return "success";
}

function compactJson(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  if (keys.length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function inferRoutingModeForTask(task: string): RoutingMode {
  const value = task.toLowerCase();
  if (/review|test|verify|qa|quality|audit|check|审核|审查|检查|测试|质检|验收|合规/.test(value)) {
    return "supervisor_pipeline";
  }
  if (/compare|debate|strategy|option|tradeoff|ambiguous|brainstorm|讨论|比较|取舍|策略|方案|头脑风暴|不确定|模糊/.test(value)) {
    return "master_slave_discussion";
  }
  if (/step|pipeline|process|workflow|draft.*then|先.*再|流程|步骤|分阶段|依次|先.*后/.test(value)) {
    return "pipeline";
  }
  if (/delegate|parallel|many|multiple|research.*write|分工|并行|多个|多项|调研.*写/.test(value)) {
    return "classic_master_slave";
  }
  return "supervisor_pipeline";
}

function localDateTimeToIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function loadSecurityRecord(): SecurityRecord | null {
  const serialized = window.localStorage.getItem("agentOpenClaw.security");
  if (!serialized) return null;
  try {
    const parsed = JSON.parse(serialized) as Partial<SecurityRecord>;
    if (
      parsed.passwordSalt &&
      parsed.passwordHash &&
      parsed.updatedAt
    ) {
      return parsed as SecurityRecord;
    }
  } catch {
    return null;
  }
  return null;
}

function createSalt() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashSecret(secret: string, salt: string) {
  const payload = `${salt}:${secret}`;
  if (!window.crypto.subtle) {
    return window.btoa(payload);
  }
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hasRecoveryQuestion(record: SecurityRecord | null) {
  return Boolean(record?.recoverySalt && record?.recoveryHash && (record.recoveryQuestion || record.recoveryQuestionId));
}

function recoveryQuestionLabel(record: SecurityRecord, language: Language) {
  if (record.recoveryQuestionId) {
    const option = recoveryQuestionOptions[language].find((candidate) => candidate.id === record.recoveryQuestionId);
    if (option) return option.label;
  }
  return record.recoveryQuestion || recoveryQuestionOptions[language][0].label;
}

function loadFirstRunPreview(): FirstRunPreview | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("honeycomb.firstRunPreview") || "null") as FirstRunPreview | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function loadFirstRunPreviewFromDesktop(): Promise<FirstRunPreview | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const serialized = await invoke<string | null>("load_first_run_setup");
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as FirstRunPreview | null;
    if (parsed && typeof parsed === "object") {
      window.localStorage.setItem("honeycomb.firstRunPreview", serialized);
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function configuredProviderLabel(preview: FirstRunPreview | null, language: Language) {
  const provider = preview?.provider;
  if (!provider?.apiKeyConfigured) {
    return language === "zh" ? "未配置" : "Not configured";
  }
  return [provider.providerName, provider.model].filter(Boolean).join(" · ") || (language === "zh" ? "已配置" : "Configured");
}

function isTauriRuntime() {
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

async function invokeDesktopCommand<T>(command: string, args: Record<string, unknown> = {}) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return { available: true, value: await invoke<T>(command, args) };
  } catch (error) {
    return isTauriRuntime() ? { available: true, error } : { available: false, error };
  }
}

const providerPresets = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com", pattern: /deepseek/i },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", pattern: /^(gpt-|o[134]|chatgpt|openai)/i },
  { name: "Alibaba Cloud Bailian", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", pattern: /qwen|通义/i },
  { name: "Zhipu AI", baseUrl: "https://open.bigmodel.cn/api/paas/v4", pattern: /glm|zhipu|智谱/i },
  { name: "Volcengine Ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", pattern: /doubao|豆包|volc|ark|ep-/i }
];

function normalizeAgentModelConfig(input: Partial<AgentModelConfig> | null | undefined): AgentModelConfig | null {
  if (!input || typeof input !== "object") return null;
  const apiKey = typeof input.apiKey === "string" ? input.apiKey : "";
  const model = typeof input.model === "string" ? input.model : "";
  const providerName = typeof input.providerName === "string" && input.providerName.trim() ? input.providerName : "DeepSeek";
  const baseUrl = typeof input.baseUrl === "string" && input.baseUrl.trim() ? input.baseUrl : "https://api.deepseek.com";
  return {
    providerName,
    baseUrl,
    model,
    apiKey,
    apiKeyConfigured: input.apiKeyConfigured === true || Boolean(apiKey.trim()),
    verifiedAt: typeof input.verifiedAt === "string" ? input.verifiedAt : undefined,
    appliedAt: typeof input.appliedAt === "string" ? input.appliedAt : undefined
  };
}

function loadAgentModelConfigs(): Record<string, AgentModelConfig> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("honeycomb.agentModelConfigs") || "{}") as Record<string, Partial<AgentModelConfig>>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([agentId, config]) => [agentId, normalizeAgentModelConfig(config)])
        .filter((entry): entry is [string, AgentModelConfig] => Boolean(entry[1]))
    );
  } catch {
    return {};
  }
}

function saveAgentModelConfigs(configs: Record<string, AgentModelConfig>) {
  window.localStorage.setItem("honeycomb.agentModelConfigs", JSON.stringify(configs));
}

async function loadProviderApiKeyFromDesktop() {
  const result = await invokeDesktopCommand<string | null>("load_provider_api_key");
  if (result.available && "value" in result && result.value) {
    window.localStorage.setItem("honeycomb.providerApiKey", result.value);
    return result.value;
  }
  return window.localStorage.getItem("honeycomb.providerApiKey") || "";
}

async function loadAgentModelConfigsFromDesktop() {
  const result = await invokeDesktopCommand<string | null>("load_agent_model_configs");
  if (!result.available || !("value" in result) || !result.value) return {};
  try {
    const parsed = JSON.parse(result.value) as Record<string, Partial<AgentModelConfig>>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([agentId, config]) => [agentId, normalizeAgentModelConfig(config)])
        .filter((entry): entry is [string, AgentModelConfig] => Boolean(entry[1]))
    );
  } catch {
    return {};
  }
}

function resolveProviderForAgent(
  model: string,
  existing: Partial<AgentModelConfig> | null | undefined,
  preview: FirstRunPreview | null
) {
  const trimmedModel = model.trim();
  const preset = providerPresets.find((candidate) => candidate.pattern.test(trimmedModel));
  if (preset) {
    return { providerName: preset.name, baseUrl: preset.baseUrl };
  }
  if (existing?.baseUrl) {
    return {
      providerName: existing.providerName || preview?.provider?.providerName || "Custom",
      baseUrl: existing.baseUrl
    };
  }
  return {
    providerName: preview?.provider?.providerName || "DeepSeek",
    baseUrl: preview?.provider?.baseUrl || "https://api.deepseek.com"
  };
}

async function saveAgentModelConfigToDesktop(agentId: string, config: AgentModelConfig) {
  return invokeDesktopCommand<ProviderConnectionResult>("save_agent_model_config", {
    payload: {
      agentId,
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey
    }
  });
}

function defaultSupervisorWorkbenchConfig(): SupervisorWorkbenchConfig {
  return {
    workspacePath: "",
    permissions: { ...defaultSupervisorPermissions },
    skills: "writing, image, video, review",
    mcpServers: "filesystem, git",
    updatedAt: new Date(0).toISOString()
  };
}

function loadSupervisorWorkbenchConfig(): SupervisorWorkbenchConfig {
  const fallback = defaultSupervisorWorkbenchConfig();
  try {
    const parsed = JSON.parse(window.localStorage.getItem("honeycomb.supervisorWorkbench") || "null") as Partial<SupervisorWorkbenchConfig> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : fallback.workspacePath,
      permissions: {
        ...fallback.permissions,
        ...(parsed.permissions && typeof parsed.permissions === "object" ? parsed.permissions : {})
      },
      skills: typeof parsed.skills === "string" ? parsed.skills : fallback.skills,
      mcpServers: typeof parsed.mcpServers === "string" ? parsed.mcpServers : fallback.mcpServers,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt
    };
  } catch {
    return fallback;
  }
}

function saveSupervisorWorkbenchConfig(config: SupervisorWorkbenchConfig) {
  window.localStorage.setItem("honeycomb.supervisorWorkbench", JSON.stringify(config));
}

function buildWorkbenchPlanSteps(job: JobRecord | null, timeline: JobTimeline | null, language: Language): WorkbenchPlanStep[] {
  const terminal = job ? ["succeeded", "failed", "cancelled"].includes(job.status) : false;
  const blocked = job ? ["failed", "cancelled"].includes(job.status) : false;
  const workVisible = Boolean(timeline?.summary.totalTimelineItems);

  const labels = language === "zh"
    ? [
        ["任务进入", job ? `${job.id} · ${routingModeLabels.zh[job.routingMode]}` : "等待用户创建第一个任务"],
        ["智能编排", job ? "面板 agent 已根据任务自动选择起步编排模式" : "创建任务后自动分析"],
        ["专业 agent 执行", workVisible ? "时间线已出现 agent 工作事件" : "等待 OpenClaw 写入执行事件"],
        ["质量关卡", terminal ? "任务已进入最终状态" : "等待测试、修正或人工确认"],
        ["交付与复盘", terminal ? "可进入记忆页采纳可复用经验" : "任务完成后沉淀经验候选"]
      ]
    : [
        ["Task intake", job ? `${job.id} · ${routingModeLabels.en[job.routingMode]}` : "Waiting for the first job"],
        ["Smart routing", job ? "The panel agent selected an initial orchestration mode for this task" : "Analyzes automatically after job creation"],
        ["Specialist execution", workVisible ? "Timeline events show agent work in progress" : "Waiting for OpenClaw execution events"],
        ["Quality gate", terminal ? "The job reached a final state" : "Waiting for testing, fixing, or human review"],
        ["Delivery and review", terminal ? "Reusable experience can be reviewed from Memory" : "Experience candidates appear after completion"]
      ];

  if (!job) {
    return labels.map(([title, body], index) => ({
      title,
      body,
      state: index === 0 ? "active" : "pending"
    }));
  }

  const executionDone = terminal || ["testing", "fixing", "waiting_for_human"].includes(job.status);
  const qualityActive = ["testing", "fixing", "waiting_for_human"].includes(job.status);

  return labels.map(([title, body], index) => {
    if (index <= 1) return { title, body, state: "done" };
    if (index === 2) {
      return {
        title,
        body,
        state: executionDone ? "done" : "active"
      };
    }
    if (index === 3) {
      return {
        title,
        body,
        state: terminal ? (blocked ? "blocked" : "done") : qualityActive ? "active" : "pending"
      };
    }
    return {
      title,
      body,
      state: terminal ? (blocked ? "blocked" : "done") : "pending"
    };
  });
}

function buildSupervisorPromptWithWorkbenchContext(
  rawPrompt: string,
  config: SupervisorWorkbenchConfig,
  supervisorName: string,
  language: Language
) {
  const workspace = config.workspacePath.trim();
  const permissionLabels = translations[language].workbenchPermissionLabels;
  const enabledPermissions = supervisorPermissionKeys
    .filter((key) => config.permissions[key])
    .map((key) => permissionLabels[key])
    .join(", ") || (language === "zh" ? "无" : "none");
  const disabledPermissions = supervisorPermissionKeys
    .filter((key) => !config.permissions[key])
    .map((key) => permissionLabels[key])
    .join(", ") || (language === "zh" ? "无" : "none");

  if (language === "zh") {
    return [
      rawPrompt.trim(),
      "",
      "[Honeycomb 主管工作台上下文]",
      `面板主管 agent: ${supervisorName}`,
      `项目工作区: ${workspace || "未设置"}`,
      `允许的权限: ${enabledPermissions}`,
      `未允许的权限: ${disabledPermissions}`,
      `可用 Skills: ${config.skills.trim() || "未设置"}`,
      `可用 MCP: ${config.mcpServers.trim() || "未设置"}`,
      "执行要求: 按上述权限和工作区边界规划任务；不要假设未允许的本地写入、命令执行或 MCP 工具可用；不要要求用户重新提供 Honeycomb 已配置的信息。"
    ].join("\n");
  }

  return [
    rawPrompt.trim(),
    "",
    "[Honeycomb supervisor workbench context]",
    `Panel supervisor agent: ${supervisorName}`,
    `Project workspace: ${workspace || "not set"}`,
    `Allowed permissions: ${enabledPermissions}`,
    `Disabled permissions: ${disabledPermissions}`,
    `Available skills: ${config.skills.trim() || "not set"}`,
    `Available MCP: ${config.mcpServers.trim() || "not set"}`,
    "Execution rule: plan within these permission and workspace boundaries; do not assume disabled local writes, command execution, or MCP tools are available; do not ask the user to repeat information already configured in Honeycomb."
  ].join("\n");
}

function App() {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  const [activeView, setActiveView] = useState<AppView>(getInitialView);
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [prompt, setPrompt] = useState("Draft a short launch note for a tiny multi-agent product.");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("supervisor_pipeline");
  const [maxModelCalls, setMaxModelCalls] = useState(20);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [jobListPage, setJobListPage] = useState<ListJobsResponse["page"] | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<JobStatusFilter>("all");
  const [jobTimeFilter, setJobTimeFilter] = useState<JobTimeFilter>("all");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [jobPromptFilter, setJobPromptFilter] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [timeline, setTimeline] = useState<JobTimeline | null>(null);
  const [experiences, setExperiences] = useState<ExperienceRecord[]>([]);
  const [experienceSummary, setExperienceSummary] = useState<ExperienceListResponse["summary"]>({
    candidate: 0,
    adopted: 0,
    rejected: 0
  });
  const [experienceFilter, setExperienceFilter] = useState<ExperienceStatus | "all">("candidate");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [memoryMessage, setMemoryMessage] = useState("");
  const [approvals, setApprovals] = useState<ToolApprovalRecord[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetFlow, setResetFlow] = useState<FirstRunFlow | null>(null);
  const [setupComplete, setSetupComplete] = useState(
    () =>
      window.localStorage.getItem("honeycomb.setupCompleted") === "true" ||
      new URLSearchParams(window.location.search).get("skipOnboarding") === "true"
  );
  const [showTour, setShowTour] = useState(
    () =>
      (window.localStorage.getItem("honeycomb.setupCompleted") === "true" ||
        new URLSearchParams(window.location.search).get("skipOnboarding") === "true") &&
      window.localStorage.getItem("honeycomb.tourCompleted") !== "true"
  );
  const [tourIndex, setTourIndex] = useState(0);
  const [sideCollapsed, setSideCollapsed] = useState(
    () => window.localStorage.getItem("honeycomb.sideCollapsed") === "true"
  );
  const [securityRecord, setSecurityRecord] = useState<SecurityRecord | null>(loadSecurityRecord);
  const [locked, setLocked] = useState(() => Boolean(loadSecurityRecord()) && window.sessionStorage.getItem("agentOpenClaw.unlocked") !== "true");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockRecoveryAnswer, setUnlockRecoveryAnswer] = useState("");
  const [unlockMode, setUnlockMode] = useState<"password" | "recovery">("password");
  const [unlockError, setUnlockError] = useState("");
  const [securityEditUnlocked, setSecurityEditUnlocked] = useState(false);
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState("");
  const [recoveryQuestionChoice, setRecoveryQuestionChoice] = useState<RecoveryQuestionId | "custom">(
    securityRecord?.recoveryQuestionId || (securityRecord?.recoveryQuestion ? "custom" : "first_project")
  );
  const [recoveryQuestionDraft, setRecoveryQuestionDraft] = useState(securityRecord?.recoveryQuestion || "");
  const [recoveryAnswerDraft, setRecoveryAnswerDraft] = useState("");
  const [securityRecoveryOpen, setSecurityRecoveryOpen] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [agentModelConfigs, setAgentModelConfigs] = useState<Record<string, AgentModelConfig>>(loadAgentModelConfigs);
  const [expandedAgentId, setExpandedAgentId] = useState("");
  const [agentConfigDraft, setAgentConfigDraft] = useState<AgentConfigDraft>({
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "",
    apiKey: "",
    apiKeyConfigured: false
  });
  const [agentConfigMessage, setAgentConfigMessage] = useState("");
  const [agentConfigError, setAgentConfigError] = useState("");
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [showAgentApiKey, setShowAgentApiKey] = useState(false);
  const [workbenchConfig, setWorkbenchConfig] = useState<SupervisorWorkbenchConfig>(loadSupervisorWorkbenchConfig);
  const [workbenchMessage, setWorkbenchMessage] = useState("");
  const jobsRequestSeq = useRef(0);
  const copy = translations[language];

  const statusText = useMemo(() => {
    if (apiState === "online") return copy.apiOnline;
    if (apiState === "offline") return copy.apiOffline;
    return copy.apiChecking;
  }, [apiState, copy]);

  const selectedFromList = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? selectedJob,
    [jobs, selectedJob, selectedJobId]
  );

  const activeStatusFilter = jobStatusFilters.find((filter) => filter.id === jobStatusFilter);
  const trimmedJobPromptFilter = jobPromptFilter.trim();
  const runningJobCount = jobs.filter((job) => ["queued", "planning", "running", "testing", "fixing"].includes(job.status)).length;
  const latestJob = jobs[0] ?? null;
  const tourStep = copy.tourSteps[tourIndex];
  const inferredRoutingMode = useMemo(() => inferRoutingModeForTask(prompt), [prompt]);
  const [firstRunPreview, setFirstRunPreview] = useState<FirstRunPreview | null>(loadFirstRunPreview);
  const configuredProvider = configuredProviderLabel(firstRunPreview, language);
  const panelSupervisorDisplayName =
    firstRunPreview?.profile?.supervisorName || (language === "zh" ? "面板主管 Agent" : "Panel supervisor agent");
  const workbenchJob = selectedFromList ?? latestJob;
  const workbenchPlanSteps = useMemo(
    () => buildWorkbenchPlanSteps(workbenchJob, timeline, language),
    [language, timeline, workbenchJob]
  );
  const enabledPermissionCount = supervisorPermissionKeys.filter((key) => workbenchConfig.permissions[key]).length;

  const allPrimaryNav = [
    { id: "dashboard" as const, icon: Gauge, label: copy.dashboard, group: copy.navGroups.operate },
    { id: "setup" as const, icon: Sparkles, label: copy.setupTab, group: copy.navGroups.operate },
    { id: "jobs" as const, icon: MessageSquare, label: copy.jobsView, group: copy.navGroups.operate },
    { id: "approvals" as const, icon: ShieldQuestion, label: copy.approvalsView, group: copy.navGroups.operate },
    { id: "agents" as const, icon: Bot, label: copy.agentsView, group: copy.navGroups.build },
    { id: "models" as const, icon: SlidersHorizontal, label: copy.modelsView, group: copy.navGroups.build },
    { id: "memory" as const, icon: History, label: copy.memoryView, group: copy.navGroups.build }
  ];
  const primaryNav = setupComplete || showTour
    ? allPrimaryNav.filter((item) => item.id !== "setup")
    : allPrimaryNav.filter((item) => item.id === "setup");
  const routingLabel = (mode: RoutingMode) => routingModeLabels[language][mode];
  const agentSequenceLabel = (value: string) => {
    if (language !== "zh") return value;
    return value
      .replaceAll("panel-supervisor-agent", "面板主管 Agent")
      .replaceAll("main-agent", "主控 Agent")
      .replaceAll("research-agent", "研究 Agent")
      .replaceAll("writer-agent", "写作 Agent")
      .replaceAll("image-agent", "图像 Agent")
      .replaceAll("video-agent", "视频 Agent")
      .replaceAll("test-agent", "质检 Agent")
      .replaceAll("main", "主控")
      .replaceAll("research", "研究")
      .replaceAll("writer", "写作")
      .replaceAll("image", "图像")
      .replaceAll("video", "视频")
      .replaceAll("test", "质检");
  };

  useEffect(() => {
    window.localStorage.setItem("agentOpenClaw.language", language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem("agentOpenClaw.activeView", activeView);
  }, [activeView]);

  useEffect(() => {
    window.localStorage.setItem("honeycomb.sideCollapsed", String(sideCollapsed));
  }, [sideCollapsed]);

  useEffect(() => {
    let cancelled = false;
    const localPreview = loadFirstRunPreview();
    if (localPreview) {
      setFirstRunPreview(localPreview);
      return;
    }
    loadFirstRunPreviewFromDesktop().then((desktopPreview) => {
      if (!cancelled && desktopPreview) {
        setFirstRunPreview(desktopPreview);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [setupComplete, activeView, resetFlow]);

  useEffect(() => {
    let cancelled = false;
    async function syncAgentConfigs() {
      const [desktopConfigs, providerApiKey] = await Promise.all([
        loadAgentModelConfigsFromDesktop(),
        loadProviderApiKeyFromDesktop()
      ]);
      if (cancelled) return;
      setAgentModelConfigs((current) => {
        const merged = { ...current, ...desktopConfigs };
        const provider = firstRunPreview?.provider;
        if (provider?.apiKeyConfigured || providerApiKey) {
          const existing = merged["panel-supervisor-agent"];
          const apiKey = existing?.apiKey || providerApiKey;
          const model = existing?.model || provider?.model || "";
          const providerReference = resolveProviderForAgent(model, existing, firstRunPreview);
          merged["panel-supervisor-agent"] = {
            providerName: existing?.providerName || provider?.providerName || providerReference.providerName,
            baseUrl: existing?.baseUrl || provider?.baseUrl || providerReference.baseUrl,
            model,
            apiKey,
            apiKeyConfigured: Boolean(apiKey.trim()) || provider?.apiKeyConfigured === true,
            verifiedAt: existing?.verifiedAt,
            appliedAt: existing?.appliedAt
          };
        }
        saveAgentModelConfigs(merged);
        return merged;
      });
    }
    void syncAgentConfigs();
    return () => {
      cancelled = true;
    };
  }, [firstRunPreview]);

  useEffect(() => {
    if (!showTour && !setupComplete && activeView !== "setup") {
      setActiveView("setup");
    }
  }, [activeView, setupComplete, showTour]);

  function getJobTimeWindow() {
    if (jobTimeFilter === "24h") {
      return { since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), until: undefined };
    }
    if (jobTimeFilter === "7d") {
      return { since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), until: undefined };
    }
    if (jobTimeFilter === "custom") {
      return {
        since: localDateTimeToIso(customSince),
        until: localDateTimeToIso(customUntil)
      };
    }
    return { since: undefined, until: undefined };
  }

  async function refreshJobs(preferredJobId = selectedJobId) {
    const requestSeq = ++jobsRequestSeq.current;
    const timeWindow = getJobTimeWindow();
    const response = await listJobs({
      limit: 50,
      status: activeStatusFilter?.status,
      prompt: trimmedJobPromptFilter || undefined,
      since: timeWindow.since,
      until: timeWindow.until,
      sort: "createdAt",
      order: "desc"
    });
    if (requestSeq !== jobsRequestSeq.current) {
      return selectedJobId;
    }

    setJobs(response.jobs);
    setJobListPage(response.page);
    const nextSelectedId = response.jobs.some((job) => job.id === preferredJobId)
      ? preferredJobId
      : response.jobs[0]?.id || "";
    setSelectedJobId(nextSelectedId);
    return nextSelectedId;
  }

  async function loadMoreJobs() {
    if (!jobListPage?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const requestSeq = ++jobsRequestSeq.current;
      const timeWindow = getJobTimeWindow();
      const response = await listJobs({
        limit: 50,
        status: activeStatusFilter?.status,
        prompt: trimmedJobPromptFilter || undefined,
        since: timeWindow.since,
        until: timeWindow.until,
        sort: "createdAt",
        order: "desc",
        cursor: jobListPage.nextCursor
      });
      if (requestSeq !== jobsRequestSeq.current) {
        return;
      }

      setJobs((currentJobs) => {
        const existingIds = new Set(currentJobs.map((job) => job.id));
        return [...currentJobs, ...response.jobs.filter((job) => !existingIds.has(job.id))];
      });
      setJobListPage(response.page);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refreshJob(targetJobId = selectedJobId) {
    if (!targetJobId) {
      setSelectedJob(null);
      setTimeline(null);
      return;
    }

    const timelineCursor =
      timeline?.job.id === targetJobId && timeline.summary.nextCursor
        ? timeline.summary.nextCursor
        : undefined;
    const [job, nextTimeline] = await Promise.all([
      getJob(targetJobId),
      getJobTimeline(targetJobId, 500, undefined, timelineCursor)
    ]);
    setSelectedJob(job);
    setTimeline((currentTimeline) => {
      if (!timelineCursor || currentTimeline?.job.id !== targetJobId) {
        return nextTimeline;
      }

      const existingIds = new Set(currentTimeline.timeline.map((item) => item.id));
      const appendedItems = nextTimeline.timeline.filter((item) => !existingIds.has(item.id));
      return {
        ...nextTimeline,
        timeline: [...currentTimeline.timeline, ...appendedItems]
      };
    });
  }

  async function refreshAll(targetJobId = selectedJobId) {
    const nextSelectedId = await refreshJobs(targetJobId);
    await refreshJob(nextSelectedId);
  }

  async function refreshExperiences() {
    const response = await listExperiences(experienceFilter === "all" ? undefined : experienceFilter);
    setExperiences(response.experiences);
    setExperienceSummary(response.summary);
  }

  async function refreshApprovals() {
    const response = await listToolApprovals({ status: "pending", limit: 100 });
    setApprovals(response.approvals);
  }

  async function decideApproval(approvalId: string, decision: "approve" | "reject") {
    setApprovalBusy(true);
    setApprovalError("");
    setApprovalMessage("");
    try {
      if (decision === "approve") {
        await approveToolApproval(approvalId, { decidedBy: "desktop-user" });
        setApprovalMessage(copy.approvalApproved);
      } else {
        await rejectToolApproval(approvalId, { decidedBy: "desktop-user" });
        setApprovalMessage(copy.approvalRejected);
      }
      await refreshApprovals();
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : copy.approvalDecisionFailed);
    } finally {
      setApprovalBusy(false);
    }
  }

  async function changeExperienceStatus(
    experienceId: string,
    status: Exclude<ExperienceStatus, "candidate">
  ) {
    setMemoryBusy(true);
    setMemoryError("");
    setMemoryMessage("");
    try {
      const result = status === "adopted"
        ? await adoptExperience(experienceId)
        : await rejectExperience(experienceId);
      setMemoryMessage(
        language === "zh"
          ? status === "adopted"
            ? "经验已采纳，后续检索可以使用它。"
            : "经验已拒绝，不会进入可复用记忆。"
          : status === "adopted"
            ? "Experience adopted and available for future retrieval."
            : "Experience rejected and excluded from reusable memory."
      );
      if (!result.changed) {
        setMemoryMessage(language === "zh" ? "经验状态没有变化。" : "Experience status was already up to date.");
      }
      await refreshExperiences();
    } catch (caught) {
      setMemoryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setMemoryBusy(false);
    }
  }

  async function submitJob() {
    setBusy(true);
    setError(null);
    try {
      const promptWithWorkbenchContext = buildSupervisorPromptWithWorkbenchContext(
        prompt,
        workbenchConfig,
        panelSupervisorDisplayName,
        language
      );
      const created = await createJob({
        prompt: promptWithWorkbenchContext,
        workdir: workbenchConfig.workspacePath.trim() || undefined,
        routingMode: inferredRoutingMode,
        maxModelCalls
      });
      await refreshAll(created.jobId);
      setActiveView("jobs");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelectedJob() {
    if (!selectedJobId) return;
    setBusy(true);
    setError(null);
    try {
      await cancelJob(selectedJobId);
      await refreshAll(selectedJobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!securityRecord) return;
    const hash = await hashSecret(unlockPassword, securityRecord.passwordSalt);
    if (hash !== securityRecord.passwordHash) {
      setUnlockError(copy.unlockFailed);
      return;
    }
    window.sessionStorage.setItem("agentOpenClaw.unlocked", "true");
    setLocked(false);
    setUnlockError("");
  }

  async function unlockWithRecovery(event: React.FormEvent) {
    event.preventDefault();
    if (!securityRecord || !hasRecoveryQuestion(securityRecord) || !securityRecord.recoverySalt || !securityRecord.recoveryHash) return;
    const hash = await hashSecret(unlockRecoveryAnswer, securityRecord.recoverySalt);
    if (hash !== securityRecord.recoveryHash) {
      setUnlockError(copy.recoveryFailed);
      return;
    }
    window.sessionStorage.setItem("agentOpenClaw.unlocked", "true");
    setLocked(false);
    setActiveView("settings");
    setUnlockError("");
  }

  function selectedRecoveryQuestion() {
    if (recoveryQuestionChoice === "custom") {
      return {
        question: recoveryQuestionDraft.trim(),
        questionId: undefined
      };
    }
    const option = recoveryQuestionOptions[language].find((candidate) => candidate.id === recoveryQuestionChoice);
    return {
      question: option?.label || recoveryQuestionOptions[language][0].label,
      questionId: recoveryQuestionChoice
    };
  }

  async function saveSecuritySettings(event: React.FormEvent) {
    event.preventDefault();
    setSettingsError("");
    setSettingsMessage("");

    if (securityRecord) {
      if (!currentPasswordDraft) {
        setSettingsError(copy.currentPasswordMissing);
        return;
      }
      const currentHash = await hashSecret(currentPasswordDraft, securityRecord.passwordSalt);
      if (currentHash !== securityRecord.passwordHash) {
        setSettingsError(copy.currentPasswordFailed);
        return;
      }
      if (!securityEditUnlocked) {
        setSecurityEditUnlocked(true);
        setPasswordDraft("");
        setConfirmPasswordDraft("");
        setRecoveryAnswerDraft("");
        setSecurityRecoveryOpen(false);
        return;
      }
      if (!passwordDraft.trim() && !securityRecoveryOpen) {
        setSettingsError(copy.noSecurityChanges);
        return;
      }
      if (passwordDraft.trim() && passwordDraft !== confirmPasswordDraft) {
        setSettingsError(copy.passwordMismatch);
        return;
      }
      const recovery = selectedRecoveryQuestion();
      if (securityRecoveryOpen && (!recovery.question || !recoveryAnswerDraft.trim())) {
        setSettingsError(copy.securityMissing);
        return;
      }
      const nextRecord: SecurityRecord = {
        ...securityRecord,
        updatedAt: new Date().toISOString()
      };
      if (passwordDraft.trim()) {
        const passwordSalt = createSalt();
        nextRecord.passwordSalt = passwordSalt;
        nextRecord.passwordHash = await hashSecret(passwordDraft, passwordSalt);
      }
      if (securityRecoveryOpen) {
        const recoverySalt = createSalt();
        nextRecord.recoveryQuestion = recovery.question;
        nextRecord.recoveryQuestionId = recovery.questionId;
        nextRecord.recoverySalt = recoverySalt;
        nextRecord.recoveryHash = await hashSecret(recoveryAnswerDraft, recoverySalt);
      }
      window.localStorage.setItem("agentOpenClaw.security", JSON.stringify(nextRecord));
      setSecurityRecord(nextRecord);
      setCurrentPasswordDraft("");
      setPasswordDraft("");
      setConfirmPasswordDraft("");
      setRecoveryAnswerDraft("");
      setSecurityRecoveryOpen(false);
      setSecurityEditUnlocked(false);
      setSettingsMessage(copy.securityPasswordSaved);
      return;
    }

    if (passwordDraft || confirmPasswordDraft) {
      if (passwordDraft !== confirmPasswordDraft) {
        setSettingsError(copy.passwordMismatch);
        return;
      }
    }

    const recovery = selectedRecoveryQuestion();

    if (!passwordDraft || !recoveryAnswerDraft || !recovery.question) {
      setSettingsError(copy.securityMissing);
      return;
    }

    const passwordSalt = createSalt();
    const recoverySalt = createSalt();

    const nextRecord: SecurityRecord = {
      passwordSalt,
      passwordHash: await hashSecret(passwordDraft, passwordSalt),
      recoveryQuestion: recovery.question,
      recoveryQuestionId: recovery.questionId,
      recoverySalt,
      recoveryHash: await hashSecret(recoveryAnswerDraft, recoverySalt),
      updatedAt: new Date().toISOString()
    };

    window.localStorage.setItem("agentOpenClaw.security", JSON.stringify(nextRecord));
    setSecurityRecord(nextRecord);
    setPasswordDraft("");
    setConfirmPasswordDraft("");
    setRecoveryAnswerDraft("");
    setSettingsMessage(copy.securitySaved);
  }

  async function cancelSecurityPassword() {
    if (!securityRecord) return;
    setSettingsError("");
    setSettingsMessage("");
    if (!currentPasswordDraft) {
      setSettingsError(copy.currentPasswordMissing);
      return;
    }
    const currentHash = await hashSecret(currentPasswordDraft, securityRecord.passwordSalt);
    if (currentHash !== securityRecord.passwordHash) {
      setSettingsError(copy.currentPasswordFailed);
      return;
    }
    window.localStorage.removeItem("agentOpenClaw.security");
    window.sessionStorage.removeItem("agentOpenClaw.unlocked");
    setSecurityRecord(null);
    setCurrentPasswordDraft("");
    setPasswordDraft("");
    setConfirmPasswordDraft("");
    setRecoveryAnswerDraft("");
    setSecurityRecoveryOpen(false);
    setSecurityEditUnlocked(false);
    setSettingsMessage(copy.passwordCancelled);
  }

  function cancelSecurityEdit() {
    setSecurityEditUnlocked(false);
    setCurrentPasswordDraft("");
    setPasswordDraft("");
    setConfirmPasswordDraft("");
    setRecoveryAnswerDraft("");
    setSecurityRecoveryOpen(false);
    setSettingsError("");
    setSettingsMessage("");
  }

  function completeTour() {
    window.localStorage.setItem("honeycomb.tourCompleted", "true");
    setShowTour(false);
    if (!setupComplete) {
      setActiveView("setup");
    }
  }

  function updateWorkbenchConfig(updater: (current: SupervisorWorkbenchConfig) => SupervisorWorkbenchConfig) {
    setWorkbenchConfig((current) => {
      const next = {
        ...updater(current),
        updatedAt: new Date().toISOString()
      };
      saveSupervisorWorkbenchConfig(next);
      return next;
    });
    setWorkbenchMessage("");
  }

  function confirmWorkbenchConfigSaved() {
    saveSupervisorWorkbenchConfig({
      ...workbenchConfig,
      updatedAt: new Date().toISOString()
    });
    setWorkbenchMessage(copy.workbenchSaved);
  }

  useEffect(() => {
    let cancelled = false;

    async function checkOpenClawStatus() {
      try {
        await getHealth();
        if (cancelled) return;
        setApiState("online");
      } catch {
        if (!cancelled) {
          setApiState("offline");
        }
      }
    }

    void checkOpenClawStatus();
    const interval = window.setInterval(() => {
      void checkOpenClawStatus();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (apiState !== "online") return;
    let cancelled = false;

    async function pollOpenClawData() {
      try {
        await refreshAll(selectedJobId);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void pollOpenClawData();
    const interval = window.setInterval(() => {
      void pollOpenClawData();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [apiState, selectedJobId, jobStatusFilter, jobTimeFilter, customSince, customUntil, trimmedJobPromptFilter]);

  useEffect(() => {
    if (!selectedJobId || apiState !== "online") return;
    refreshJob(selectedJobId).catch((caught) =>
      setError(caught instanceof Error ? caught.message : String(caught))
    );
  }, [selectedJobId, apiState]);

  useEffect(() => {
    if (apiState !== "online") return;
    refreshAll("").catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [jobStatusFilter, jobTimeFilter, customSince, customUntil, trimmedJobPromptFilter, apiState]);

  useEffect(() => {
    if (activeView !== "memory" || apiState !== "online") return;
    setMemoryError("");
    refreshExperiences().catch((caught) =>
      setMemoryError(caught instanceof Error ? caught.message : String(caught))
    );
  }, [activeView, apiState, experienceFilter]);

  useEffect(() => {
    if (activeView !== "approvals" || apiState !== "online") return;
    let cancelled = false;

    async function loadApprovals() {
      try {
        const response = await listToolApprovals({ status: "pending", limit: 100 });
        if (!cancelled) {
          setApprovals(response.approvals);
          setApprovalError("");
        }
      } catch (caught) {
        if (!cancelled) {
          setApprovalError(caught instanceof Error ? caught.message : copy.approvalLoadFailed);
        }
      }
    }

    void loadApprovals();
    const interval = window.setInterval(() => {
      void loadApprovals();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeView, apiState, copy.approvalLoadFailed]);

  if (locked && securityRecord) {
    const canRecover = hasRecoveryQuestion(securityRecord);
    return (
      <main className="lockScreen">
        <form className="lockPanel" onSubmit={unlockMode === "password" ? unlockWithPassword : unlockWithRecovery}>
          <div className="lockMark">
            <LockKeyhole size={32} aria-hidden="true" />
          </div>
          <h1>{copy.lockTitle}</h1>
          <p>{unlockMode === "password" ? copy.lockSubtitle : recoveryQuestionLabel(securityRecord, language)}</p>
          {unlockMode === "password" ? (
            <label>
              {copy.password}
              <input
                type="password"
                value={unlockPassword}
                onChange={(event) => setUnlockPassword(event.target.value)}
                autoFocus
              />
            </label>
          ) : (
            <label>
              {copy.recoveryAnswer}
              <input
                type="password"
                value={unlockRecoveryAnswer}
                onChange={(event) => setUnlockRecoveryAnswer(event.target.value)}
                autoFocus
              />
            </label>
          )}
          {unlockError ? <p className="error">{unlockError}</p> : null}
          <button className="primaryButton" type="submit">
            <KeyRound size={16} aria-hidden="true" />
            {copy.unlock}
          </button>
          {canRecover ? (
            <button
              className="textButton"
              type="button"
              onClick={() => {
                setUnlockError("");
                setUnlockMode(unlockMode === "password" ? "recovery" : "password");
              }}
            >
              {unlockMode === "password" ? copy.forgotPassword : copy.usePassword}
            </button>
          ) : null}
        </form>
      </main>
    );
  }

  function renderDashboard() {
    return (
      <section className="deskPage dashboardPage" data-tour-anchor="dashboard">
        <div className="pageHero">
          <div>
            <p className="eyebrow">
              <span className={`miniDot ${apiState}`} />
              {statusText}
            </p>
            <h1>{copy.dashboard}</h1>
            <p>{copy.subtitle}</p>
          </div>
          <div className="heroActions">
            <button className="secondaryButton" type="button" onClick={() => setActiveView("jobs")}>
              <TerminalSquare size={16} aria-hidden="true" />
              {copy.openJobs}
            </button>
          </div>
        </div>

        <div className="overviewGrid">
          <article className="metricPanel">
            <span>{copy.gatewayPanel}</span>
            <strong>{statusText}</strong>
            <small>http://localhost:3000</small>
          </article>
          <article className="metricPanel">
            <span>{copy.totalJobs}</span>
            <strong>{jobs.length}</strong>
            <small>{copy.jobs}</small>
          </article>
          <article className="metricPanel">
            <span>{copy.runningJobs}</span>
            <strong>{runningJobCount}</strong>
            <small>{copy.statusFilters.running}</small>
          </article>
          <article className="metricPanel">
            <span>{copy.currentModel}</span>
            <strong>{firstRunPreview?.provider?.model || copy.unconfigured}</strong>
            <small>{firstRunPreview?.provider?.providerName || copy.unconfigured}</small>
          </article>
        </div>

        <div className="dashboardContent">
          <section className="deskPanel">
            <div className="panelHeader">
              <h2>{copy.latestJob}</h2>
              <button className="iconTextButton" type="button" onClick={() => setActiveView("jobs")}>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
            {latestJob ? (
              <button className="latestJobButton" type="button" onClick={() => {
                setSelectedJobId(latestJob.id);
                setActiveView("jobs");
              }}>
                <span className={`dot ${statusTone(latestJob.status)}`} />
                <span>
                  <strong>{latestJob.id}</strong>
                  <small>{routingLabel(latestJob.routingMode)}</small>
                </span>
                <em>{copy.statuses[latestJob.status]}</em>
              </button>
            ) : (
              <p className="emptyState">{copy.noLatestJob}</p>
            )}
          </section>

          <section className="deskPanel">
            <div className="panelHeader">
              <h2>{copy.gatewayPanel}</h2>
              <RefreshCw size={16} aria-hidden="true" />
            </div>
            <div className="systemRows">
              <div>
                <span>{copy.gatewayHint}</span>
                <strong>localhost:3000</strong>
              </div>
              <div>
                <span>{copy.modelHint}</span>
                <strong>{configuredProvider}</strong>
              </div>
              <div>
                <span>{copy.agentHint}</span>
                <strong>{agentSequenceLabel("main / research / writer / image / test")}</strong>
              </div>
            </div>
          </section>
        </div>

        <section className="deskPanel capabilityPanel">
          <div className="panelHeader">
            <div>
              <h2>{copy.capabilityTitle}</h2>
              <p className="mutedText">{copy.capabilityIntro}</p>
            </div>
            <Sparkles size={17} aria-hidden="true" />
          </div>
          <div className="supervisorWorkbenchGrid">
            <article className="workbenchCard runtimeCard">
              <span className="workbenchStatusPill">{copy.workbenchLive}</span>
              <strong>{copy.workbenchRuntime}</strong>
              <div className="workbenchRows">
                <div>
                  <span>{copy.gatewayPanel}</span>
                  <em>{statusText}</em>
                </div>
                <div>
                  <span>{copy.modelHint}</span>
                  <em>{configuredProvider}</em>
                </div>
                <div>
                  <span>{copy.agentHint}</span>
                  <em>{panelSupervisorDisplayName}</em>
                </div>
              </div>
            </article>

            <article className="workbenchCard streamCard">
              <span className="workbenchStatusPill">{copy.workbenchLive}</span>
              <strong>{copy.workbenchStreaming}</strong>
              <div className="streamSnapshot">
                <div>
                  <span>{copy.workbenchLatestJob}</span>
                  <em>{workbenchJob?.id ?? copy.workbenchNoJob}</em>
                </div>
                <div>
                  <span>{copy.status}</span>
                  <em>{workbenchJob ? copy.statuses[workbenchJob.status] : "-"}</em>
                </div>
                <div>
                  <span>{copy.workbenchTimelineItems}</span>
                  <em>{timeline?.summary.totalTimelineItems ?? 0}</em>
                </div>
              </div>
              <button className="secondaryButton compactButton" type="button" onClick={() => setActiveView("jobs")}>
                <ChevronRight size={14} aria-hidden="true" />
                {copy.openJobs}
              </button>
            </article>

            <article className="workbenchCard planCard">
              <span className="workbenchStatusPill">{copy.workbenchLocal}</span>
              <strong>{copy.workbenchPlan}</strong>
              <ol className="workbenchPlanList">
                {workbenchPlanSteps.map((step) => (
                  <li className={`planStep ${step.state}`} key={step.title}>
                    <span />
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </article>

            <article className="workbenchCard configCard">
              <span className="workbenchStatusPill">{copy.workbenchStored}</span>
              <strong>{copy.workbenchWorkspace}</strong>
              <label>
                {copy.workbenchWorkspaceLabel}
                <input
                  value={workbenchConfig.workspacePath}
                  placeholder={copy.workbenchWorkspacePlaceholder}
                  onChange={(event) => updateWorkbenchConfig((current) => ({ ...current, workspacePath: event.target.value }))}
                />
              </label>
              <button className="secondaryButton compactButton" type="button" onClick={confirmWorkbenchConfigSaved}>
                <CheckCircle2 size={14} aria-hidden="true" />
                {copy.workbenchSave}
              </button>
            </article>

            <article className="workbenchCard permissionCard">
              <span className="workbenchStatusPill">{enabledPermissionCount}/{supervisorPermissionKeys.length}</span>
              <strong>{copy.workbenchPermissions}</strong>
              <div className="permissionToggleGrid">
                {supervisorPermissionKeys.map((key) => (
                  <label className="permissionToggle" key={key}>
                    <input
                      type="checkbox"
                      checked={workbenchConfig.permissions[key]}
                      onChange={(event) =>
                        updateWorkbenchConfig((current) => ({
                          ...current,
                          permissions: {
                            ...current.permissions,
                            [key]: event.target.checked
                          }
                        }))
                      }
                    />
                    <span>{copy.workbenchPermissionLabels[key]}</span>
                  </label>
                ))}
              </div>
            </article>

            <article className="workbenchCard toolsCard">
              <span className="workbenchStatusPill">{copy.workbenchStored}</span>
              <strong>{copy.workbenchSkills}</strong>
              <div className="workbenchTextareas">
                <label>
                  {copy.workbenchSkillsLabel}
                  <textarea
                    value={workbenchConfig.skills}
                    placeholder={copy.workbenchSkillsPlaceholder}
                    onChange={(event) => updateWorkbenchConfig((current) => ({ ...current, skills: event.target.value }))}
                  />
                </label>
                <label>
                  {copy.workbenchMcpLabel}
                  <textarea
                    value={workbenchConfig.mcpServers}
                    placeholder={copy.workbenchMcpPlaceholder}
                    onChange={(event) => updateWorkbenchConfig((current) => ({ ...current, mcpServers: event.target.value }))}
                  />
                </label>
              </div>
              <button className="secondaryButton compactButton" type="button" onClick={confirmWorkbenchConfigSaved}>
                <CheckCircle2 size={14} aria-hidden="true" />
                {copy.workbenchSave}
              </button>
            </article>
          </div>
          {workbenchMessage ? <p className="successMessage">{workbenchMessage}</p> : null}
        </section>
      </section>
    );
  }

  function renderApprovals() {
    return (
      <section className="deskPage approvalsPage">
        <section className="pageHero compactHero">
          <div>
            <p className="eyebrow">
              <ShieldQuestion size={15} aria-hidden="true" />
              {copy.pendingApprovals}
            </p>
            <h1>{copy.approvalQueueTitle}</h1>
            <p>{copy.approvalQueueHint}</p>
          </div>
          <div className="heroActions">
            <span className={`status ${apiState}`}>{statusText}</span>
            <button
              className="secondaryButton compactButton"
              type="button"
              onClick={() => refreshApprovals().catch((caught) => setApprovalError(caught instanceof Error ? caught.message : copy.approvalLoadFailed))}
              disabled={apiState !== "online" || approvalBusy}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {copy.refresh}
            </button>
          </div>
        </section>

        {approvalMessage ? <p className="successMessage">{approvalMessage}</p> : null}
        {approvalError ? <p className="error">{approvalError}</p> : null}

        <section className="approvalQueue">
          {approvals.length ? (
            approvals.map((approval) => {
              const inputJson = compactJson(approval.input);
              const policyJson = compactJson(approval.policy);
              return (
                <article className="approvalCard" key={approval.id}>
                  <div className="approvalCardHeader">
                    <div>
                      <strong>{approval.toolName}</strong>
                      <span>{approval.id}</span>
                    </div>
                    <em className={`riskPill ${riskTone(approval.riskLevel)}`}>
                      {copy.approvalRisk}: {approval.riskLevel}
                    </em>
                  </div>

                  <dl className="approvalDetails">
                    <div>
                      <dt>{copy.approvalAction}</dt>
                      <dd>{approval.actionType}</dd>
                    </div>
                    <div>
                      <dt>{copy.approvalTarget}</dt>
                      <dd>{approval.target || "-"}</dd>
                    </div>
                    <div>
                      <dt>{copy.approvalCommand}</dt>
                      <dd>{approval.command || "-"}</dd>
                    </div>
                    <div>
                      <dt>{copy.approvalRequestedBy}</dt>
                      <dd>{approval.agentId} / {approval.requesterActor}</dd>
                    </div>
                    <div className="wide">
                      <dt>{copy.approvalReason}</dt>
                      <dd>{approval.reason || "-"}</dd>
                    </div>
                  </dl>

                  {inputJson || policyJson ? (
                    <div className="approvalPayloads">
                      {inputJson ? (
                        <pre aria-label="approval input">{inputJson}</pre>
                      ) : null}
                      {policyJson ? (
                        <pre aria-label="approval policy">{policyJson}</pre>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="approvalActions">
                    <button
                      className="secondaryButton"
                      type="button"
                      disabled={approvalBusy}
                      onClick={() => decideApproval(approval.id, "reject")}
                    >
                      <X size={15} aria-hidden="true" />
                      {copy.reject}
                    </button>
                    <button
                      className="primaryButton"
                      type="button"
                      disabled={approvalBusy}
                      onClick={() => decideApproval(approval.id, "approve")}
                    >
                      <CheckCircle2 size={15} aria-hidden="true" />
                      {copy.approve}
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="deskPanel emptyApprovalPanel">
              <ShieldQuestion size={28} aria-hidden="true" />
              <p>{copy.noPendingApprovals}</p>
            </div>
          )}
        </section>
      </section>
    );
  }

  function renderJobs() {
    return (
      <section className="deskPage jobsPage" data-tour-anchor="jobs">
        <section className="composerBand">
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitJob();
            }}
          >
            <div className="panelHeader">
              <h1>{copy.newJob}</h1>
              <span className={`status ${apiState}`}>{statusText}</span>
            </div>
            <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <div className="composerControls">
              <div className="smartRoutingBadge" data-testid="smart-routing-badge">
                <strong>{copy.smartRouting}</strong>
                <span>{copy.smartRoutingHint}</span>
                <em>{routingLabel(inferredRoutingMode)}</em>
              </div>
              <label htmlFor="maxModelCalls">{copy.budget}</label>
              <input
                id="maxModelCalls"
                type="number"
                min="1"
                max="100"
                value={maxModelCalls}
                onChange={(event) => setMaxModelCalls(Number(event.target.value))}
              />
              <button data-testid="start-job-button" className="primaryButton" type="submit" disabled={apiState !== "online" || busy || !prompt.trim()}>
                <Play size={16} aria-hidden="true" />
                {copy.startJob}
              </button>
            </div>
            {error ? <p className="error">{error}</p> : null}
          </form>
        </section>

        <section className="jobWorkspace">
          <aside className="jobList">
            <div className="sectionHeader">
              <h2>{copy.jobs}</h2>
              <span>{jobListPage?.hasMore ? `${jobs.length}+` : jobs.length}</span>
            </div>
            <div className="jobFilters">
              <div className="filterSegments" aria-label={copy.jobStatusFilter}>
                {jobStatusFilters.map((filter) => (
                  <button
                    key={filter.id}
                    className={filter.id === jobStatusFilter ? "filterSegment active" : "filterSegment"}
                    data-filter={filter.id}
                    type="button"
                    onClick={() => setJobStatusFilter(filter.id)}
                  >
                    {copy.statusFilters[filter.id]}
                  </button>
                ))}
              </div>
              <label className="searchField">
                <Search size={15} aria-hidden="true" />
                <input
                  id="jobSearch"
                  type="search"
                  aria-label={copy.searchPromptsAria}
                  placeholder={copy.searchPrompts}
                  value={jobPromptFilter}
                  onChange={(event) => setJobPromptFilter(event.target.value)}
                />
              </label>
              <div className="filterSegments timeFilterSegments" aria-label={copy.jobTimeFilter}>
                {jobTimeFilters.map((filter) => (
                  <button
                    key={filter.id}
                    className={filter.id === jobTimeFilter ? "filterSegment active" : "filterSegment"}
                    data-time-filter={filter.id}
                    type="button"
                    onClick={() => setJobTimeFilter(filter.id)}
                  >
                    {copy.timeFilters[filter.id]}
                  </button>
                ))}
              </div>
              {jobTimeFilter === "custom" ? (
                <div className="customTimeFilters">
                  <label htmlFor="jobSince">{copy.since}</label>
                  <input
                    id="jobSince"
                    type="datetime-local"
                    value={customSince}
                    onChange={(event) => {
                      setJobTimeFilter("custom");
                      setCustomSince(event.target.value);
                    }}
                  />
                  <label htmlFor="jobUntil">{copy.until}</label>
                  <input
                    id="jobUntil"
                    type="datetime-local"
                    value={customUntil}
                    onChange={(event) => {
                      setJobTimeFilter("custom");
                      setCustomUntil(event.target.value);
                    }}
                  />
                </div>
              ) : null}
            </div>
            <ol>
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    className={job.id === selectedJobId ? "jobRow selected" : "jobRow"}
                    type="button"
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <span className={`dot ${statusTone(job.status)}`} />
                    <span className="jobMeta">
                      <strong>{job.id}</strong>
                      <span>{routingLabel(job.routingMode)}</span>
                    </span>
                    <span className="jobStatus">{copy.statuses[job.status]}</span>
                    <span className="jobTime">{formatTime(job.createdAt, language)}</span>
                  </button>
                </li>
              ))}
              {jobs.length === 0 ? <li className="emptyState">{copy.noJobsMatch}</li> : null}
            </ol>
            {jobListPage?.hasMore ? (
              <div className="loadMoreRow">
                <button className="secondaryButton" type="button" onClick={loadMoreJobs} disabled={busy}>
                  {copy.loadMore}
                </button>
              </div>
            ) : null}
          </aside>

          <section className="jobDetail">
            <div className="sectionHeader detailHeader">
              <div>
                <h2>{selectedFromList?.id ?? copy.noJobSelected}</h2>
                <p>{selectedFromList ? `${selectedFromList.ingressOrigin} / ${routingLabel(selectedFromList.routingMode)}` : "-"}</p>
              </div>
              <button
                className="dangerButton"
                type="button"
                onClick={cancelSelectedJob}
                disabled={!isCancellable(selectedFromList) || busy}
              >
                {selectedFromList?.status === "cancelled" ? copy.cancelled : copy.cancel}
              </button>
            </div>

            {selectedFromList ? (
              <dl className="stats">
                <div>
                  <dt>{copy.status}</dt>
                  <dd>{copy.statuses[selectedFromList.status]}</dd>
                </div>
                <div>
                  <dt>{copy.created}</dt>
                  <dd>{formatTime(selectedFromList.createdAt, language)}</dd>
                </div>
                <div>
                  <dt>{copy.budget}</dt>
                  <dd>{selectedFromList.maxModelCalls}</dd>
                </div>
                <div>
                  <dt>{copy.timeline}</dt>
                  <dd>{timeline?.summary.totalTimelineItems ?? 0}</dd>
                </div>
              </dl>
            ) : (
              <p className="emptyState">{copy.noJobLoaded}</p>
            )}

            <div className="timelineHeader">
              <h3>{copy.timeline}</h3>
              <span>{timeline?.summary.truncated ? copy.latestItems : copy.complete}</span>
            </div>
            <ol className="timeline">
              {timeline?.timeline.length ? (
                timeline.timeline.map((item) => (
                  <li key={item.id} className="timelineItem">
                    <time>{formatTime(item.at, language)}</time>
                    <span className={`source source-${item.source}`}>{copy.sources[item.source]}</span>
                    <div>
                      <strong>{compactEventType(item.eventType)}</strong>
                      <p>{item.title}</p>
                      {item.actor ? <small>{item.actor}</small> : null}
                    </div>
                  </li>
                ))
              ) : (
                <li className="emptyState">{copy.noTimelineEvents}</li>
              )}
            </ol>
          </section>
        </section>
      </section>
    );
  }

  function openAgentConfig(agentId: string) {
    const existing = agentModelConfigs[agentId];
    const inheritedApiKey = agentId === "panel-supervisor-agent"
      ? window.localStorage.getItem("honeycomb.providerApiKey") || ""
      : "";
    const model = existing?.model || firstRunPreview?.provider?.model || "";
    const providerReference = resolveProviderForAgent(model, existing, firstRunPreview);
    setExpandedAgentId((current) => (current === agentId ? "" : agentId));
    setAgentConfigDraft({
      providerName: existing?.providerName || firstRunPreview?.provider?.providerName || providerReference.providerName,
      baseUrl: existing?.baseUrl || firstRunPreview?.provider?.baseUrl || providerReference.baseUrl,
      model,
      apiKey: existing?.apiKey || inheritedApiKey,
      apiKeyConfigured: existing?.apiKeyConfigured === true || Boolean(existing?.apiKey || inheritedApiKey)
    });
    setShowAgentApiKey(false);
    setAgentConfigMessage("");
    setAgentConfigError("");
  }

  function updateAgentConfigDraft(field: keyof AgentConfigDraft, value: string) {
    setAgentConfigDraft((current) => ({ ...current, [field]: value }));
    setAgentConfigMessage("");
    setAgentConfigError("");
  }

  async function saveAgentConfig(agentId: string) {
    if (agentConfigSaving) return;
    setAgentConfigError("");
    setAgentConfigMessage(copy.agentConfigSaving);
    const existing = agentModelConfigs[agentId];
    const inheritedApiKey = agentId === "panel-supervisor-agent"
      ? window.localStorage.getItem("honeycomb.providerApiKey") || ""
      : "";
    const apiKey = agentConfigDraft.apiKey.trim() || existing?.apiKey?.trim() || inheritedApiKey;
    const model = agentConfigDraft.model.trim();
    if (!model || !apiKey) {
      setAgentConfigMessage("");
      setAgentConfigError(copy.agentConfigMissing);
      return;
    }
    const providerReference = resolveProviderForAgent(model, existing || agentConfigDraft, firstRunPreview);
    const nextConfig: AgentModelConfig = {
      providerName: providerReference.providerName,
      baseUrl: providerReference.baseUrl,
      model,
      apiKey,
      apiKeyConfigured: true
    };
    setAgentConfigSaving(true);
    try {
      const desktopResult = await saveAgentModelConfigToDesktop(agentId, nextConfig);
      if (desktopResult.available && "error" in desktopResult) {
        throw desktopResult.error;
      }
      const verifiedAt = new Date().toISOString();
      const savedConfig = {
        ...nextConfig,
        verifiedAt,
        appliedAt: verifiedAt
      };
      const nextConfigs = {
        ...agentModelConfigs,
        [agentId]: savedConfig
      };
      saveAgentModelConfigs(nextConfigs);
      setAgentModelConfigs(nextConfigs);
      setAgentConfigDraft(savedConfig);
      if (agentId === "panel-supervisor-agent") {
        window.localStorage.setItem("honeycomb.providerApiKey", apiKey);
        void invokeDesktopCommand("save_provider_api_key", { payload: apiKey });
      }
      setAgentConfigMessage(copy.agentConfigSaved);
    } catch {
      setAgentConfigMessage("");
      setAgentConfigError(copy.agentConfigVerifyFailed);
    } finally {
      setAgentConfigSaving(false);
    }
  }

  function cancelAgentConfig() {
    setExpandedAgentId("");
    setAgentConfigMessage("");
    setAgentConfigError("");
    setAgentConfigSaving(false);
    setShowAgentApiKey(false);
  }

  function renderAgents() {
    const agents = [
      {
        id: "panel-supervisor-agent",
        name: panelSupervisorDisplayName,
        description: language === "zh" ? "同时担任面板 agent 和主控 agent，负责理解任务、选择编排、分配工作并整合结果。" : "Acts as both the panel agent and main control agent: understands tasks, chooses routing, delegates work, and synthesizes results.",
        modelTag: configuredProvider,
        configured: firstRunPreview?.provider?.apiKeyConfigured === true
      },
      {
        id: "research-agent",
        name: language === "zh" ? "研究 Agent" : "Research agent",
        description: language === "zh" ? "收集背景、证据、约束和风险，为后续工作建立可靠上下文。" : "Collects context, evidence, constraints, and risks before downstream work starts.",
        modelTag: copy.unconfigured,
        configured: false
      },
      {
        id: "writer-agent",
        name: language === "zh" ? "写作 Agent" : "Writer agent",
        description: language === "zh" ? "把研究和计划转化为清晰、成熟、可以交付的文字产出。" : "Turns research and plans into clear, polished, deliverable writing.",
        modelTag: copy.unconfigured,
        configured: false
      },
      {
        id: "image-agent",
        name: language === "zh" ? "图像 Agent" : "Image agent",
        description: language === "zh" ? "生成视觉方案、图片 brief 和可执行的图像提示词。" : "Produces visual directions, image briefs, and executable image prompts.",
        modelTag: copy.unconfigured,
        configured: false
      },
      {
        id: "video-agent",
        name: language === "zh" ? "视频 Agent" : "Video agent",
        description: language === "zh" ? "生成分镜、镜头设计、视频脚本和可执行的视频制作提示词。" : "Produces storyboards, shot plans, video scripts, and executable video production prompts.",
        modelTag: copy.unconfigured,
        configured: false
      },
      {
        id: "test-agent",
        name: language === "zh" ? "质检 Agent" : "Test agent",
        description: language === "zh" ? "按照用户质量标准检查结果，并给出通过或修改建议。" : "Checks results against the user's quality bar and recommends pass or revision.",
        modelTag: copy.unconfigured,
        configured: false
      }
    ];
    return (
      <section className="deskPage utilityPage">
        <div className="pageHero compactHero">
          <div>
            <p className="eyebrow">{copy.agentHint}</p>
            <h1>{copy.agentsView}</h1>
          </div>
        </div>
        <div className="agentGrid">
          {agents.map((agent) => {
            const savedConfig = agentModelConfigs[agent.id];
            const savedHasKey = Boolean(savedConfig?.apiKey?.trim());
            const providerKeyConfigured = agent.id === "panel-supervisor-agent" &&
              firstRunPreview?.provider?.apiKeyConfigured === true &&
              Boolean(window.localStorage.getItem("honeycomb.providerApiKey"));
            const configured = agent.id === "panel-supervisor-agent"
              ? savedHasKey || providerKeyConfigured
              : savedHasKey;
            const modelTag = savedHasKey
              ? [savedConfig.providerName, savedConfig.model].filter(Boolean).join(" · ")
              : agent.modelTag;
            const expanded = expandedAgentId === agent.id;
            return (
              <article className={expanded ? "deskPanel agentPanel expanded" : "deskPanel agentPanel"} key={agent.id}>
                <Bot size={20} aria-hidden="true" />
                <div>
                  <h2>{agent.name}</h2>
                  <small>{agent.id}</small>
                </div>
                <p>{agent.description}</p>
                <span className={configured ? "agentModelTag" : "agentModelTag pending"}>{modelTag}</span>
                <small className="agentConfigHint">
                  {configured ? (agent.id === "panel-supervisor-agent" ? copy.panelAgentConfigured : copy.agentConfigured) : copy.specialistNeedsKey}
                </small>
                <button className="primaryButton compactButton agentConfigureButton" type="button" onClick={() => openAgentConfig(agent.id)}>
                  <KeyRound size={14} aria-hidden="true" />
                  {copy.configureModelKey}
                </button>
                {expanded ? (
                  <div className="agentConfigPanel">
                    <div className="panelHeader">
                      <div>
                        <h3>{copy.agentConfigTitle}</h3>
                        <p className="mutedText">{agent.name}</p>
                      </div>
                      <span className={agentConfigDraft.apiKeyConfigured ? "agentModelTag" : "agentModelTag pending"}>
                        {agentConfigDraft.apiKeyConfigured ? copy.agentConfigured : copy.unconfigured}
                      </span>
                    </div>
                    <div className="agentConfigFields">
                      <label>
                        {copy.model}
                        <input value={agentConfigDraft.model} onChange={(event) => updateAgentConfigDraft("model", event.target.value)} />
                      </label>
                      <label>
                        {copy.apiKey}
                        <span className="apiKeyInputShell">
                          <input
                            type={showAgentApiKey ? "text" : "password"}
                            value={agentConfigDraft.apiKey}
                            placeholder={agentConfigDraft.apiKeyConfigured ? "••••••••" : ""}
                            onChange={(event) => updateAgentConfigDraft("apiKey", event.target.value)}
                            autoComplete="off"
                          />
                          <button
                            className="apiKeyToggle"
                            type="button"
                            aria-label={showAgentApiKey ? "Hide API Key" : "Show API Key"}
                            onClick={() => setShowAgentApiKey((current) => !current)}
                          >
                            {showAgentApiKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                          </button>
                        </span>
                      </label>
                    </div>
                    {agentConfigError ? <p className="error">{agentConfigError}</p> : null}
                    {agentConfigMessage ? <p className="successMessage">{agentConfigMessage}</p> : null}
                    <div className="agentConfigActions">
                      <button className="primaryButton compactButton" type="button" disabled={agentConfigSaving} onClick={() => void saveAgentConfig(agent.id)}>
                        <CheckCircle2 size={14} aria-hidden="true" />
                        {copy.saveAgentConfig}
                      </button>
                      <button className="secondaryButton compactButton" type="button" onClick={cancelAgentConfig}>
                        {copy.cancelConfig}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  function renderModels() {
    const flowSteps = routingModeFlows[language][routingMode];
    return (
      <section className="deskPage utilityPage">
        <div className="pageHero compactHero">
          <div>
            <p className="eyebrow">{copy.gatewayPanel}</p>
            <h1>{copy.modelsView}</h1>
          </div>
        </div>
        <div className="modelLayout">
          <section className="deskPanel routingModePanel">
            <div className="panelHeader">
              <div>
                <h2>{copy.routing}</h2>
                <p className="mutedText">{copy.modelsFlowHint}</p>
              </div>
              <span className="agentModelTag">{configuredProvider}</span>
            </div>
            <div className="routingList modelRoutingList">
              {routingModes.map((mode) => (
                <button
                  key={mode}
                  className={mode === routingMode ? "routingOption selected" : "routingOption"}
                  type="button"
                  onClick={() => setRoutingMode(mode)}
                >
                  <span>{routingLabel(mode)}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="deskPanel routingFlowPanel">
            <div className="panelHeader">
              <div>
                <h2>{copy.routingFlow} · {routingLabel(routingMode)}</h2>
                <p className="mutedText">{language === "zh" ? "这张流程图说明该模式如何组织任务，而不是强制每次任务都使用它。" : "This diagram explains how the mode organizes work; each task can still choose a different mode."}</p>
              </div>
            </div>
            <div className="routingFlowChart">
              {flowSteps.map((step, index) => (
                <article key={`${routingMode}-${step.title}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    );
  }

  function renderMemory() {
    const statusLabels: Record<ExperienceStatus, string> = {
      candidate: language === "zh" ? "待确认" : "Pending review",
      adopted: language === "zh" ? "已采纳" : "Adopted",
      rejected: language === "zh" ? "已拒绝" : "Rejected"
    };
    const filterLabels: Record<ExperienceStatus | "all", string> = {
      all: language === "zh" ? "全部" : "All",
      candidate: statusLabels.candidate,
      adopted: statusLabels.adopted,
      rejected: statusLabels.rejected
    };
    const scopeLabel = (experience: ExperienceRecord) => {
      if (experience.scope === "routing_mode" && routingModes.includes(experience.scopeKey as RoutingMode)) {
        return routingLabel(experience.scopeKey as RoutingMode);
      }
      return experience.scopeKey;
    };

    return (
      <section className="deskPage utilityPage">
        <div className="pageHero compactHero">
          <div>
            <p className="eyebrow">{copy.memoryHint}</p>
            <h1>{copy.memoryView}</h1>
          </div>
        </div>
        <div className="settingsGrid">
          <section className="deskPanel">
            <h2>{language === "zh" ? "提示词库" : "Prompt library"}</h2>
            <div className="systemRows">
              <div>
                <span>{language === "zh" ? "首次启动配置包" : "First Run bundle"}</span>
                <strong>{language === "zh" ? "桌面首次启动" : "desktop-first-run"}</strong>
              </div>
              <div>
                <span>{language === "zh" ? "Agent 提示词" : "Agent prompts"}</span>
                <strong>{language === "zh" ? "主控 / 研究 / 写作 / 图像 / 质检" : "main / research / writer / image / test"}</strong>
              </div>
            </div>
          </section>
          <section className="deskPanel">
            <h2>{language === "zh" ? "经验记忆" : "Experience memory"}</h2>
            <p className="mutedText">
              {language === "zh"
                ? "任务历史、产物、评审和最终总结会沉淀为可复用经验。写入前由用户确认，避免错误经验自动扩散。"
                : "Job history, artifacts, reviews, and final summaries become reusable experience after user review, so weak conclusions do not spread automatically."}
            </p>
            <div className="memoryStates">
              <span>{language === "zh" ? "待确认经验" : "Pending review"} <strong>{experienceSummary.candidate}</strong></span>
              <span>{language === "zh" ? "已采纳经验" : "Adopted"} <strong>{experienceSummary.adopted}</strong></span>
              <span>{language === "zh" ? "已拒绝经验" : "Rejected"} <strong>{experienceSummary.rejected}</strong></span>
            </div>
          </section>
        </div>
        <section className="deskPanel memoryWorkspace">
          <div className="panelHeader memoryToolbar">
            <div>
              <h2>{language === "zh" ? "经验候选" : "Experience candidates"}</h2>
              <p className="mutedText">
                {language === "zh"
                  ? "任务成功只会生成待确认候选；只有你采纳后，它才会成为可复用记忆。"
                  : "Successful jobs create review candidates only. They become reusable memory after you adopt them."}
              </p>
            </div>
            <button
              className="secondaryButton compactButton"
              type="button"
              onClick={() => refreshExperiences().catch((caught) => setMemoryError(caught instanceof Error ? caught.message : String(caught)))}
              disabled={apiState !== "online" || memoryBusy}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {language === "zh" ? "刷新" : "Refresh"}
            </button>
          </div>
          <div className="memoryFilters" aria-label={language === "zh" ? "经验状态筛选" : "Experience status filters"}>
            {(["candidate", "adopted", "rejected", "all"] as const).map((status) => (
              <button
                key={status}
                className={experienceFilter === status ? "memoryFilterButton active" : "memoryFilterButton"}
                type="button"
                onClick={() => setExperienceFilter(status)}
              >
                {filterLabels[status]}
              </button>
            ))}
          </div>
          {memoryError ? <p className="error">{memoryError}</p> : null}
          {memoryMessage ? <p className="successMessage">{memoryMessage}</p> : null}
          {apiState !== "online" ? (
            <div className="emptyState">
              {language === "zh" ? "后端离线，连接后即可查看经验候选。" : "The backend is offline. Connect it to review experience candidates."}
            </div>
          ) : experiences.length === 0 ? (
            <div className="emptyState">
              {language === "zh" ? "当前筛选条件下没有经验。" : "No experiences match this filter."}
            </div>
          ) : (
            <div className="experienceList" data-testid="experience-list">
              {experiences.map((experience) => (
                <article className="experienceCard" key={experience.id}>
                  <div className="experienceHeader">
                    <div>
                      <span className={`experienceStatus ${experience.status}`}>{statusLabels[experience.status]}</span>
                      <h3>{language === "zh" ? "编排运行结果" : "Routing outcome"}</h3>
                    </div>
                    <strong>{Math.round(experience.confidence * 100)}%</strong>
                  </div>
                  <p>
                    {language === "zh" && experience.kind === "routing_outcome"
                      ? `编排模式「${scopeLabel(experience)}」已成功完成一次任务；请结合来源证据判断它是否值得复用。`
                      : experience.summary}
                  </p>
                  <dl className="experienceMeta">
                    <div>
                      <dt>{language === "zh" ? "作用域" : "Scope"}</dt>
                      <dd>{scopeLabel(experience)}</dd>
                    </div>
                    <div>
                      <dt>{language === "zh" ? "来源任务" : "Source job"}</dt>
                      <dd>{experience.sourceJobId}</dd>
                    </div>
                    <div>
                      <dt>{language === "zh" ? "证据" : "Evidence"}</dt>
                      <dd>{experience.evidence.length} {language === "zh" ? "组" : "groups"}</dd>
                    </div>
                    <div>
                      <dt>{language === "zh" ? "出现次数" : "Occurrences"}</dt>
                      <dd>{experience.occurrenceCount}</dd>
                    </div>
                  </dl>
                  {experience.status === "candidate" ? (
                    <div className="experienceActions">
                      <button
                        className="primaryButton compactButton"
                        type="button"
                        data-testid="experience-adopt"
                        disabled={memoryBusy}
                        onClick={() => changeExperienceStatus(experience.id, "adopted")}
                      >
                        <CheckCircle2 size={14} aria-hidden="true" />
                        {language === "zh" ? "采纳" : "Adopt"}
                      </button>
                      <button
                        className="secondaryButton compactButton"
                        type="button"
                        data-testid="experience-reject"
                        disabled={memoryBusy}
                        onClick={() => changeExperienceStatus(experience.id, "rejected")}
                      >
                        <X size={14} aria-hidden="true" />
                        {language === "zh" ? "拒绝" : "Reject"}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    );
  }

  function renderSettings() {
    return (
      <section className="deskPage utilityPage" data-tour-anchor="settings">
        <div className="pageHero compactHero">
          <div>
            <p className="eyebrow">{copy.settingsHint}</p>
            <h1>{copy.settingsView}</h1>
          </div>
        </div>
        <div className="settingsGrid">
          <form className="deskPanel securityPanel" onSubmit={saveSecuritySettings}>
            <div className="panelHeader">
              <h2>{copy.securityTitle}</h2>
              {securityRecord ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            </div>
            <p>{securityRecord ? copy.securityConfiguredIntro : copy.securityIntro}</p>
            {securityRecord ? (
              securityEditUnlocked ? (
                <>
                  <label>
                    {copy.newPassword}
                    <input type="password" value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} />
                  </label>
                  <label>
                    {copy.confirmPassword}
                    <input type="password" value={confirmPasswordDraft} onChange={(event) => setConfirmPasswordDraft(event.target.value)} />
                  </label>
                  <div className="securityActions">
                    <button className="primaryButton" type="submit">
                      <ShieldQuestion size={16} aria-hidden="true" />
                      {copy.savePassword}
                    </button>
                    <button className="secondaryButton" type="button" onClick={() => setSecurityRecoveryOpen((current) => !current)}>
                      {copy.changeRecoveryQuestion}
                    </button>
                    <button className="secondaryButton" type="button" onClick={() => void cancelSecurityPassword()}>
                      {copy.cancelPassword}
                    </button>
                    <button className="secondaryButton" type="button" onClick={cancelSecurityEdit}>
                      {copy.cancelModify}
                    </button>
                  </div>
                  {securityRecoveryOpen ? (
                    <div className="recoveryManagePanel">
                      <p>{recoveryQuestionLabel(securityRecord, language)}</p>
                      <label>
                        {copy.recoveryQuestion}
                        <select
                          value={recoveryQuestionChoice}
                          onChange={(event) => setRecoveryQuestionChoice(event.target.value as RecoveryQuestionId | "custom")}
                        >
                          {recoveryQuestionOptions[language].map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                          <option value="custom">{copy.recoveryQuestionOther}</option>
                        </select>
                      </label>
                      {recoveryQuestionChoice === "custom" ? (
                        <label>
                          {copy.customRecoveryQuestion}
                          <input value={recoveryQuestionDraft} onChange={(event) => setRecoveryQuestionDraft(event.target.value)} />
                        </label>
                      ) : null}
                      <label>
                        {copy.recoveryAnswer}
                        <input type="password" value={recoveryAnswerDraft} onChange={(event) => setRecoveryAnswerDraft(event.target.value)} />
                      </label>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <label>
                    {copy.panelPassword}
                    <input type="password" value={currentPasswordDraft} onChange={(event) => setCurrentPasswordDraft(event.target.value)} />
                  </label>
                  <button className="primaryButton" type="submit">
                    <ShieldQuestion size={16} aria-hidden="true" />
                    {copy.savePassword}
                  </button>
                </>
              )
            ) : (
              <>
                <label>
                  {copy.password}
                  <input type="password" value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} />
                </label>
                <label>
                  {copy.confirmPassword}
                  <input type="password" value={confirmPasswordDraft} onChange={(event) => setConfirmPasswordDraft(event.target.value)} />
                </label>
                <label>
                  {copy.recoveryQuestion}
                  <select
                    value={recoveryQuestionChoice}
                    onChange={(event) => setRecoveryQuestionChoice(event.target.value as RecoveryQuestionId | "custom")}
                  >
                    {recoveryQuestionOptions[language].map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                    <option value="custom">{copy.recoveryQuestionOther}</option>
                  </select>
                </label>
                {recoveryQuestionChoice === "custom" ? (
                  <label>
                    {copy.customRecoveryQuestion}
                    <input value={recoveryQuestionDraft} onChange={(event) => setRecoveryQuestionDraft(event.target.value)} />
                  </label>
                ) : null}
                <label>
                  {copy.recoveryAnswer}
                  <input type="password" value={recoveryAnswerDraft} onChange={(event) => setRecoveryAnswerDraft(event.target.value)} />
                </label>
              </>
            )}
            {settingsError ? <p className="error">{settingsError}</p> : null}
            {settingsMessage ? <p className="successMessage">{settingsMessage}</p> : null}
            {!securityRecord ? (
              <button className="primaryButton" type="submit">
                <ShieldQuestion size={16} aria-hidden="true" />
                {copy.saveSecurity}
              </button>
            ) : null}
          </form>

          <section className="deskPanel">
            <div className="panelHeader">
              <h2>{copy.languageLabel}</h2>
              <Languages size={18} aria-hidden="true" />
            </div>
            <div className="languageToggle" role="group" aria-label={copy.languageLabel}>
              {languageOptions.map((option) => (
                <button
                  key={option.id}
                  className={option.id === language ? "languageButton active" : "languageButton"}
                  type="button"
                  onClick={() => setLanguage(option.id)}
                  aria-pressed={option.id === language}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="deskPanel resetPanel">
            <div className="panelHeader">
              <h2>{copy.resetTitle}</h2>
              <RefreshCw size={18} aria-hidden="true" />
            </div>
            <p>{copy.resetIntro}</p>
            <div className="resetActions">
              <button
                className="secondaryButton resetActionButton"
                type="button"
                onClick={() => {
                  setResetFlow("panelAgent");
                  setActiveView("setup");
                }}
              >
                <Sparkles size={16} aria-hidden="true" />
                <span>
                  <strong>{copy.resetPanelAgent}</strong>
                  <small>{copy.resetPanelAgentHint}</small>
                </span>
              </button>
              <button
                className="secondaryButton resetActionButton"
                type="button"
                onClick={() => {
                  setResetFlow("workProfile");
                  setActiveView("setup");
                }}
              >
                <Bot size={16} aria-hidden="true" />
                <span>
                  <strong>{copy.resetWorkProfile}</strong>
                  <small>{copy.resetWorkProfileHint}</small>
                </span>
              </button>
            </div>
          </section>
        </div>
      </section>
    );
  }

  function renderActiveView() {
    if (resetFlow) {
      return (
        <FirstRunPanel
          language={language}
          flow={resetFlow}
          onCancel={() => {
            setResetFlow(null);
            setActiveView("settings");
          }}
          onComplete={() => {
            setResetFlow(null);
            setSetupComplete(true);
            setShowTour(false);
            setActiveView("settings");
          }}
        />
      );
    }
    if (!setupComplete && !showTour) {
      return (
        <FirstRunPanel
          language={language}
          onComplete={(nextView) => {
            setSetupComplete(true);
            setActiveView(nextView ?? "dashboard");
            setShowTour(window.localStorage.getItem("honeycomb.tourCompleted") !== "true");
          }}
        />
      );
    }
    if (activeView === "dashboard") return renderDashboard();
    if (activeView === "setup" && !setupComplete) {
      return (
        <FirstRunPanel
          language={language}
          onComplete={(nextView) => {
            setSetupComplete(true);
            setActiveView(nextView ?? "dashboard");
            setShowTour(window.localStorage.getItem("honeycomb.tourCompleted") !== "true");
          }}
        />
      );
    }
    if (activeView === "setup") return renderDashboard();
    if (activeView === "jobs") return renderJobs();
    if (activeView === "approvals") return renderApprovals();
    if (activeView === "agents") return renderAgents();
    if (activeView === "models") return renderModels();
    if (activeView === "memory") return renderMemory();
    return renderSettings();
  }

  return (
    <main className={`shell darkShell ${sideCollapsed ? "sideCollapsed" : ""}`}>
      <aside className="activityRail" data-tour-anchor="activity">
        <div className="railBrand">
          <HoneycombLogo size={30} />
        </div>
        <nav aria-label="Primary">
          <button
            className="railButton"
            data-testid="sidebar-toggle"
            type="button"
            title={sideCollapsed ? (language === "zh" ? "展开侧栏" : "Expand sidebar") : (language === "zh" ? "收起侧栏" : "Collapse sidebar")}
            aria-label={sideCollapsed ? (language === "zh" ? "展开侧栏" : "Expand sidebar") : (language === "zh" ? "收起侧栏" : "Collapse sidebar")}
            onClick={() => setSideCollapsed((current) => !current)}
          >
            {sideCollapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
          </button>
          {primaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? "railButton active" : "railButton"}
                data-testid={
                  item.id === "setup" ? "setup-view-tab" : item.id === "jobs" ? "console-view-tab" : undefined
                }
                type="button"
                title={item.label}
                aria-label={item.label}
                onClick={() => setActiveView(item.id)}
              >
                <Icon size={20} aria-hidden="true" />
              </button>
            );
          })}
        </nav>
        <div className="railBottom">
          {setupComplete || showTour ? (
            <button className="railButton" type="button" title={copy.settingsView} aria-label={copy.settingsView} onClick={() => setActiveView("settings")}>
              <Settings size={20} aria-hidden="true" />
            </button>
          ) : null}
          <button className="railButton" type="button" title={copy.languageLabel} aria-label={copy.languageLabel} onClick={() => setLanguage(language === "zh" ? "en" : "zh")}>
            <Languages size={20} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <aside className="sideBar" aria-hidden={sideCollapsed}>
        <div className="sideHeader">
          <div>
            <strong>{copy.appName}</strong>
            <small>{copy.subtitle}</small>
          </div>
        </div>
        <nav className="sideNav" aria-label="Sections">
          {[copy.navGroups.operate, copy.navGroups.build].map((group) => (
            <div className="navGroup" key={group}>
              <span>{group}</span>
              {primaryNav.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={activeView === item.id ? "navItem active" : "navItem"}
                    data-testid={
                      item.id === "setup" ? "setup-view-tab-secondary" : item.id === "jobs" ? "console-view-tab-secondary" : undefined
                    }
                    type="button"
                    onClick={() => setActiveView(item.id)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sideFooter">
          <span className={`status ${apiState}`}>{statusText}</span>
          <button className="secondaryButton compactButton" type="button" onClick={() => refreshAll().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))} disabled={apiState !== "online" || busy}>
            <RefreshCw size={15} aria-hidden="true" />
            {copy.refresh}
          </button>
        </div>
      </aside>

      <section className="workspace">{renderActiveView()}</section>

      {showTour ? (
        <div className="tourOverlay" data-anchor={tourStep.anchor satisfies TourAnchor}>
          <div className="tourCard">
            <button className="tourClose" type="button" aria-label={copy.tourSkip} onClick={completeTour}>
              <X size={16} aria-hidden="true" />
            </button>
            <div className="tourMark">
              <HoneycombLogo size={42} mode="talking" />
              <span>{copy.tourProgress} {tourIndex + 1} / {copy.tourSteps.length}</span>
            </div>
            <h2>{tourStep.title}</h2>
            <p>{tourStep.body}</p>
            <div className="tourActions">
              <button className="textButton" type="button" onClick={completeTour}>
                {copy.tourSkip}
              </button>
              <button
                className="primaryButton"
                type="button"
                onClick={() => {
                  if (tourIndex >= copy.tourSteps.length - 1) {
                    completeTour();
                    return;
                  }
                  const nextIndex = tourIndex + 1;
                  setTourIndex(nextIndex);
                  const nextAnchor = copy.tourSteps[nextIndex].anchor;
                  if (nextAnchor === "jobs") setActiveView("jobs");
                  if (nextAnchor === "settings") setActiveView("settings");
                  if (nextAnchor === "dashboard" || nextAnchor === "activity") setActiveView("dashboard");
                }}
              >
                {tourIndex >= copy.tourSteps.length - 1 ? copy.tourDone : copy.tourNext}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
