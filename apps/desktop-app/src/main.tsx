import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
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
  cancelJob,
  createJob,
  getHealth,
  getJob,
  getJobTimeline,
  listJobs,
  type JobRecord,
  type JobStatus,
  type JobTimeline,
  type ListJobsResponse,
  type RoutingMode
} from "./api";
import { FirstRunPanel } from "./firstRun";
import { HoneycombLogo } from "./brand";
import "./styles.css";

type ApiState = "checking" | "online" | "offline";
type JobStatusFilter = "all" | "running" | "waiting_for_human" | "cancelled";
type JobTimeFilter = "all" | "24h" | "7d" | "custom";
type Language = "en" | "zh";
type AppView = "dashboard" | "setup" | "jobs" | "agents" | "models" | "memory" | "settings";
type TourAnchor = "activity" | "dashboard" | "setup" | "jobs" | "settings";

type SecurityRecord = {
  passwordSalt: string;
  passwordHash: string;
  recoveryQuestion: string;
  recoverySalt: string;
  recoveryHash: string;
  updatedAt: string;
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

const routingModeModelMap: Record<RoutingMode, Array<{ role: string; agents: string; model: string }>> = {
  supervisor_pipeline: [
    { role: "Planner", agents: "main-agent", model: "deepseek-v4-pro" },
    { role: "Stage workers", agents: "research / writer / image", model: "deepseek-v4-pro" },
    { role: "Supervisor", agents: "test-agent", model: "deepseek-v4-pro" }
  ],
  pipeline: [
    { role: "Planner", agents: "main-agent", model: "deepseek-v4-pro" },
    { role: "Sequential stages", agents: "research → writer → image", model: "deepseek-v4-pro" },
    { role: "Final check", agents: "test-agent", model: "deepseek-v4-pro" }
  ],
  classic_master_slave: [
    { role: "Lead", agents: "main-agent", model: "deepseek-v4-pro" },
    { role: "Workers", agents: "research / writer / image", model: "deepseek-v4-pro" },
    { role: "Reviewer", agents: "test-agent", model: "deepseek-v4-pro" }
  ],
  master_slave_discussion: [
    { role: "Lead", agents: "main-agent", model: "deepseek-v4-pro" },
    { role: "Discussion team", agents: "research / writer / image / test", model: "deepseek-v4-pro" },
    { role: "Synthesis", agents: "main-agent", model: "deepseek-v4-pro" }
  ]
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

const translations = {
  en: {
    appName: "honeycomb",
    subtitle: "Local multi-agent control desk",
    apiOnline: "API online",
    apiOffline: "API offline",
    apiChecking: "Checking API",
    refresh: "Refresh",
    languageLabel: "Language",
    setupTab: "First Run",
    consoleTab: "Console",
    dashboard: "Dashboard",
    jobsView: "Jobs",
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
    runningJobs: "Running jobs",
    totalJobs: "Total jobs",
    latestJob: "Latest job",
    noLatestJob: "No job yet",
    gatewayPanel: "Gateway",
    gatewayHint: "Backend status and local API address",
    currentModel: "Planner model",
    modelHint: "DeepSeek / deepseek-v4-pro",
    agentHint: "Agent framework",
    memoryHint: "Prompts and experience memory",
    settingsHint: "Security, language, and local preferences",
    securityTitle: "Security",
    securityIntro: "Set a local panel password and a recovery question.",
    password: "Password",
    confirmPassword: "Confirm password",
    recoveryQuestion: "Recovery question",
    recoveryAnswer: "Recovery answer",
    saveSecurity: "Save security",
    securitySaved: "Security settings saved.",
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
        anchor: "setup",
        title: "First Run",
        body: "Connect a provider, answer the progressive work interview, and generate a specialized agent team."
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
    apiOnline: "API 在线",
    apiOffline: "API 离线",
    apiChecking: "正在检查 API",
    refresh: "刷新",
    languageLabel: "语言",
    setupTab: "首次启动",
    consoleTab: "控制台",
    dashboard: "仪表盘",
    jobsView: "任务",
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
    runningJobs: "运行中任务",
    totalJobs: "任务总数",
    latestJob: "最近任务",
    noLatestJob: "还没有任务",
    gatewayPanel: "Gateway",
    gatewayHint: "后端状态和本地 API 地址",
    currentModel: "Planner 模型",
    modelHint: "DeepSeek / deepseek-v4-pro",
    agentHint: "Agent 框架",
    memoryHint: "提示词和经验记忆",
    settingsHint: "安全、语言和本地偏好",
    securityTitle: "安全设置",
    securityIntro: "设置本地面板密码和忘记密码密保问题。",
    password: "管理密码",
    confirmPassword: "确认密码",
    recoveryQuestion: "密保问题",
    recoveryAnswer: "密保答案",
    saveSecurity: "保存安全设置",
    securitySaved: "安全设置已保存。",
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
        anchor: "setup",
        title: "首次启动",
        body: "连接 Provider，完成渐进式工作访谈，生成专属于你的 Agent 团队。"
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
  if (storedView === "console") return "jobs";
  if (
    storedView === "dashboard" ||
    storedView === "setup" ||
    storedView === "jobs" ||
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
      parsed.recoveryQuestion &&
      parsed.recoverySalt &&
      parsed.recoveryHash &&
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTour, setShowTour] = useState(
    () => window.localStorage.getItem("agentOpenClaw.tourCompleted") !== "true"
  );
  const [tourIndex, setTourIndex] = useState(0);
  const [setupComplete, setSetupComplete] = useState(
    () =>
      window.localStorage.getItem("honeycomb.setupCompleted") === "true" ||
      new URLSearchParams(window.location.search).get("skipOnboarding") === "true"
  );
  const [sideCollapsed, setSideCollapsed] = useState(
    () => window.localStorage.getItem("honeycomb.sideCollapsed") === "true"
  );
  const [securityRecord, setSecurityRecord] = useState<SecurityRecord | null>(loadSecurityRecord);
  const [locked, setLocked] = useState(() => Boolean(loadSecurityRecord()) && window.sessionStorage.getItem("agentOpenClaw.unlocked") !== "true");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockRecoveryAnswer, setUnlockRecoveryAnswer] = useState("");
  const [unlockMode, setUnlockMode] = useState<"password" | "recovery">("password");
  const [unlockError, setUnlockError] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState("");
  const [recoveryQuestionDraft, setRecoveryQuestionDraft] = useState(
    securityRecord?.recoveryQuestion || "What project should this panel protect?"
  );
  const [recoveryAnswerDraft, setRecoveryAnswerDraft] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState("");
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

  const allPrimaryNav = [
    { id: "dashboard" as const, icon: Gauge, label: copy.dashboard, group: copy.navGroups.operate },
    { id: "setup" as const, icon: Sparkles, label: copy.setupTab, group: copy.navGroups.operate },
    { id: "jobs" as const, icon: MessageSquare, label: copy.jobsView, group: copy.navGroups.operate },
    { id: "agents" as const, icon: Bot, label: copy.agentsView, group: copy.navGroups.build },
    { id: "models" as const, icon: SlidersHorizontal, label: copy.modelsView, group: copy.navGroups.build },
    { id: "memory" as const, icon: History, label: copy.memoryView, group: copy.navGroups.build }
  ];
  const primaryNav = setupComplete || showTour
    ? allPrimaryNav
    : allPrimaryNav.filter((item) => item.id === "setup");
  const routingLabel = (mode: RoutingMode) => routingModeLabels[language][mode];
  const agentSequenceLabel = (value: string) => {
    if (language !== "zh") return value;
    return value
      .replaceAll("main-agent", "主控 Agent")
      .replaceAll("research-agent", "研究 Agent")
      .replaceAll("writer-agent", "写作 Agent")
      .replaceAll("image-agent", "图像 Agent")
      .replaceAll("test-agent", "质检 Agent")
      .replaceAll("main", "主控")
      .replaceAll("research", "研究")
      .replaceAll("writer", "写作")
      .replaceAll("image", "图像")
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

  async function submitJob() {
    setBusy(true);
    setError(null);
    try {
      const created = await createJob({
        prompt,
        routingMode,
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
    if (!securityRecord) return;
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

  async function saveSecuritySettings(event: React.FormEvent) {
    event.preventDefault();
    setSettingsError("");
    setSettingsMessage("");

    if (passwordDraft || confirmPasswordDraft) {
      if (passwordDraft !== confirmPasswordDraft) {
        setSettingsError(copy.passwordMismatch);
        return;
      }
    }

    if (!securityRecord && (!passwordDraft || !recoveryAnswerDraft)) {
      setSettingsError(copy.securityMissing);
      return;
    }

    if (recoveryQuestionDraft.trim() && !securityRecord && !recoveryAnswerDraft) {
      setSettingsError(copy.securityMissing);
      return;
    }

    const passwordSalt = passwordDraft ? createSalt() : securityRecord?.passwordSalt;
    const recoverySalt = recoveryAnswerDraft ? createSalt() : securityRecord?.recoverySalt;
    if (!passwordSalt || !recoverySalt) {
      setSettingsError(copy.securityMissing);
      return;
    }

    const nextRecord: SecurityRecord = {
      passwordSalt,
      passwordHash: passwordDraft
        ? await hashSecret(passwordDraft, passwordSalt)
        : securityRecord?.passwordHash || "",
      recoveryQuestion: recoveryQuestionDraft.trim() || securityRecord?.recoveryQuestion || copy.recoveryQuestion,
      recoverySalt,
      recoveryHash: recoveryAnswerDraft
        ? await hashSecret(recoveryAnswerDraft, recoverySalt)
        : securityRecord?.recoveryHash || "",
      updatedAt: new Date().toISOString()
    };

    if (!nextRecord.passwordHash || !nextRecord.recoveryHash) {
      setSettingsError(copy.securityMissing);
      return;
    }

    window.localStorage.setItem("agentOpenClaw.security", JSON.stringify(nextRecord));
    setSecurityRecord(nextRecord);
    setPasswordDraft("");
    setConfirmPasswordDraft("");
    setRecoveryAnswerDraft("");
    setSettingsMessage(copy.securitySaved);
  }

  function completeTour() {
    window.localStorage.setItem("agentOpenClaw.tourCompleted", "true");
    setShowTour(false);
    if (!setupComplete) {
      setActiveView("setup");
    }
  }

  useEffect(() => {
    getHealth()
      .then(() => {
        setApiState("online");
        return refreshAll();
      })
      .catch(() => setApiState("offline"));
  }, []);

  useEffect(() => {
    if (!selectedJobId || apiState !== "online") return;
    refreshJob(selectedJobId).catch((caught) =>
      setError(caught instanceof Error ? caught.message : String(caught))
    );
  }, [selectedJobId, apiState]);

  useEffect(() => {
    if (apiState !== "online") return;
    const interval = window.setInterval(() => {
      refreshAll(selectedJobId).catch(() => {
        setApiState("offline");
      });
    }, 4000);
    return () => window.clearInterval(interval);
  }, [apiState, selectedJobId, jobStatusFilter, jobTimeFilter, customSince, customUntil, trimmedJobPromptFilter]);

  useEffect(() => {
    if (apiState !== "online") return;
    refreshAll("").catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [jobStatusFilter, jobTimeFilter, customSince, customUntil, trimmedJobPromptFilter, apiState]);

  if (locked && securityRecord) {
    return (
      <main className="lockScreen">
        <form className="lockPanel" onSubmit={unlockMode === "password" ? unlockWithPassword : unlockWithRecovery}>
          <div className="lockMark">
            <LockKeyhole size={32} aria-hidden="true" />
          </div>
          <h1>{copy.lockTitle}</h1>
          <p>{unlockMode === "password" ? copy.lockSubtitle : securityRecord.recoveryQuestion}</p>
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
            <button className="primaryButton" type="button" onClick={() => setActiveView("setup")}>
              <Sparkles size={16} aria-hidden="true" />
              {copy.startSetup}
            </button>
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
            <strong>deepseek-v4-pro</strong>
            <small>DeepSeek</small>
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
                <strong>{routingLabel(routingMode)}</strong>
              </div>
              <div>
                <span>{copy.agentHint}</span>
                <strong>{agentSequenceLabel("main / research / writer / image / test")}</strong>
              </div>
            </div>
          </section>
        </div>
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
              <label htmlFor="routingMode">{copy.routing}</label>
              <select
                id="routingMode"
                value={routingMode}
                onChange={(event) => setRoutingMode(event.target.value as RoutingMode)}
              >
                {routingModes.map((mode) => (
                  <option value={mode} key={mode}>
                    {routingLabel(mode)}
                  </option>
                ))}
              </select>
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

  function renderAgents() {
    const agents = [
      {
        id: "main-agent",
        name: language === "zh" ? "主控 Agent" : "Main agent",
        description: language === "zh" ? "拆解目标、选择编排模式、分配工作并整合最终结果。" : "Breaks down goals, selects routing, delegates work, and synthesizes the final result."
      },
      {
        id: "research-agent",
        name: language === "zh" ? "研究 Agent" : "Research agent",
        description: language === "zh" ? "收集背景、证据、约束和风险，为后续工作建立可靠上下文。" : "Collects context, evidence, constraints, and risks before downstream work starts."
      },
      {
        id: "writer-agent",
        name: language === "zh" ? "写作 Agent" : "Writer agent",
        description: language === "zh" ? "把研究和计划转化为清晰、成熟、可以交付的文字产出。" : "Turns research and plans into clear, polished, deliverable writing."
      },
      {
        id: "image-agent",
        name: language === "zh" ? "图像 Agent" : "Image agent",
        description: language === "zh" ? "生成视觉方案、图片 brief 和可执行的图像提示词。" : "Produces visual directions, image briefs, and executable image prompts."
      },
      {
        id: "test-agent",
        name: language === "zh" ? "质检 Agent" : "Test agent",
        description: language === "zh" ? "按照用户质量标准检查结果，并给出通过或修改建议。" : "Checks results against the user's quality bar and recommends pass or revision."
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
          {agents.map((agent) => (
            <article className="deskPanel agentPanel" key={agent.id}>
              <Bot size={20} aria-hidden="true" />
              <div>
                <h2>{agent.name}</h2>
                <small>{agent.id}</small>
              </div>
              <p>{agent.description}</p>
              <span className="agentModelTag">DeepSeek · deepseek-v4-pro</span>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderModels() {
    const roleLabels: Record<string, string> = language === "zh"
      ? {
          Planner: "规划模型",
          "Stage workers": "阶段执行模型",
          Supervisor: "监督模型",
          "Sequential stages": "顺序阶段模型",
          "Final check": "最终检查模型",
          Lead: "主控模型",
          Workers: "执行模型",
          Reviewer: "评审模型",
          "Discussion team": "讨论团队模型",
          Synthesis: "整合模型"
        }
      : {};
    return (
      <section className="deskPage utilityPage">
        <div className="pageHero compactHero">
          <div>
            <p className="eyebrow">{copy.gatewayPanel}</p>
            <h1>{copy.modelsView}</h1>
          </div>
        </div>
        <div className="modelLayout">
          <section className="deskPanel">
            <h2>{copy.routing}</h2>
            <p className="mutedText">
              {language === "zh" ? "选择编排模式，查看该模式中每个角色实际使用的模型。" : "Choose a routing mode to inspect the model used by every role in that mode."}
            </p>
            <div className="routingList modelRoutingList">
              {routingModes.map((mode) => (
                <button
                  key={mode}
                  className={mode === routingMode ? "routingOption selected" : "routingOption"}
                  type="button"
                  onClick={() => setRoutingMode(mode)}
                >
                  <span>{routingLabel(mode)}</span>
                  <small>{language === "zh" ? "编排配置" : mode}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="deskPanel">
            <div className="panelHeader">
              <div>
                <h2>{routingLabel(routingMode)}</h2>
                <p className="mutedText">{language === "zh" ? "当前所有角色使用同一个已配置模型；后续可分别覆盖。" : "All roles currently use the configured model; each role can be overridden later."}</p>
              </div>
              <span className="agentModelTag">DeepSeek</span>
            </div>
            <div className="modelRoleList">
              {routingModeModelMap[routingMode].map((entry) => (
                <article key={`${entry.role}-${entry.agents}`}>
                  <div>
                    <span>{roleLabels[entry.role] || entry.role}</span>
                    <strong>{agentSequenceLabel(entry.agents)}</strong>
                  </div>
                  <code>{entry.model}</code>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    );
  }

  function renderMemory() {
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
              <span>{language === "zh" ? "待确认经验" : "Pending review"} <strong>0</strong></span>
              <span>{language === "zh" ? "已采纳经验" : "Adopted"} <strong>0</strong></span>
            </div>
          </section>
        </div>
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
            <p>{copy.securityIntro}</p>
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
              <input value={recoveryQuestionDraft} onChange={(event) => setRecoveryQuestionDraft(event.target.value)} />
            </label>
            <label>
              {copy.recoveryAnswer}
              <input type="password" value={recoveryAnswerDraft} onChange={(event) => setRecoveryAnswerDraft(event.target.value)} />
            </label>
            {settingsError ? <p className="error">{settingsError}</p> : null}
            {settingsMessage ? <p className="successMessage">{settingsMessage}</p> : null}
            <button className="primaryButton" type="submit">
              <ShieldQuestion size={16} aria-hidden="true" />
              {copy.saveSecurity}
            </button>
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
        </div>
      </section>
    );
  }

  function renderActiveView() {
    if (activeView === "dashboard") return renderDashboard();
    if (activeView === "setup") {
      return (
        <FirstRunPanel
          language={language}
          onComplete={() => {
            setSetupComplete(true);
            setActiveView("dashboard");
          }}
        />
      );
    }
    if (activeView === "jobs") return renderJobs();
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
                  if (nextAnchor === "setup") setActiveView("setup");
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
