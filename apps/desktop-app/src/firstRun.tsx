import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import type { RoutingMode } from "./api";
import { HoneycombLogo } from "./brand";

type Language = "en" | "zh";
type SetupStage =
  | "welcome"
  | "welcomeLeaving"
  | "provider"
  | "providerReturning"
  | "providerLeaving"
  | "interview"
  | "thinking"
  | "review"
  | "saving"
  | "openclawInvite";

type ProviderDraft = {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

let runtimeProviderApiKey = "";

type ProviderConnectionResult = {
  ok: boolean;
  message?: string;
};

type InterviewSuggestions = {
  roleExamples: string[];
  workOptions: string[];
  qualityExamples: string[];
};

type InterviewDraft = {
  industry: string;
  role: string;
  dailyWork: string;
  outputs: string;
  audience: string;
  qualityBar: string;
  constraints: string;
};

type GeneratedAgent = {
  id: string;
  displayName: string;
  role: string;
  prompt: string;
};

type Profile = {
  title: string;
  workPattern: string;
  recommendedRoutingMode: RoutingMode;
  stageAgents: string[];
  summary: string;
};

export type FirstRunFlow = "full" | "panelAgent" | "workProfile";

type FirstRunPanelProps = {
  language: Language;
  onComplete: (nextView?: "dashboard" | "agents" | "settings") => void;
  onCancel?: () => void;
  flow?: FirstRunFlow;
};

type SavedSetupPreview = {
  provider?: Partial<ProviderDraft> & { apiKeyConfigured?: boolean };
  interview?: Partial<InterviewDraft>;
  profile?: Partial<Profile> & { supervisorName?: string };
};

const emptyInterview: InterviewDraft = {
  industry: "",
  role: "",
  dailyWork: "",
  outputs: "",
  audience: "",
  qualityBar: "",
  constraints: ""
};

const routingModeDisplayLabels: Record<Language, Record<RoutingMode, string>> = {
  en: {
    supervisor_pipeline: "Supervisor pipeline",
    pipeline: "Sequential pipeline",
    classic_master_slave: "Classic lead-worker mode",
    master_slave_discussion: "Lead-worker discussion mode"
  },
  zh: {
    supervisor_pipeline: "主管流水线模式",
    pipeline: "顺序流水线模式",
    classic_master_slave: "经典主从模式",
    master_slave_discussion: "主从讨论模式"
  }
};

const copyByLanguage = {
  en: {
    heading: "First Run",
    welcomeTitle: "Start creating your first dedicated AI employee",
    supervisorQuestion: "Name your supervisor agent",
    supervisorPlaceholder: "For example: Honeycomb Supervisor",
    welcomeNext: "Next",
    providerEyebrow: "Private provider setup",
    providerTitle: "Start creating your first dedicated AI employee",
    providerIntro:
      "Honeycomb will use this Provider to understand your work, customize dedicated prompts for your Agent team, and later fit into your workflow as the supervisor. Your API key will not be written into generated prompt files. The model can be changed at any time.",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "Model",
    modelPlaceholder: "For example: deepseek-v4-pro",
    apiKey: "API key",
    back: "Back",
    cancelSetup: "Cancel setup",
    connect: "Connect and continue",
    providerMissing: "Add the model and API key to continue.",
    providerReuseHint: "A previous API key is already configured. Leave this blank to reuse it.",
    verifyingProvider: "Verifying connection...",
    providerVerified: "Connection verified.",
    providerVerifyFailed: "Could not verify the model connection. Check the model and API key, then try again.",
    interviewEyebrow: "Work interview",
    interviewTitle: "Tell Honeycomb how you work",
    interviewReason:
      "Your answers let the panel choose a practical routing mode and rewrite each agent prompt around your real work.",
    privacy: "These answers are used only to configure this local panel. They are never uploaded or disclosed.",
    thinking: "Agent is thinking",
    next: "Next",
    reviewTitle: "Your agent team is ready",
    reviewIntro:
      "Review the initial profile Honeycomb inferred. This tailored routing mode is only the starting default; each future task should still be analyzed before choosing the concrete orchestration mode.",
    profile: "Detected profile",
    routing: "Tailored routing mode",
    stages: "Agent sequence",
    write: "Create my agent team",
    saving: "Writing local setup",
    openclawInvite: "Then shall we start configuring multiple agents in OpenClaw to work for you?",
    openclawInviteNo: "No...",
    openclawInviteYes: "Yes!!!",
    openclawInviteSad: "But without multiple agents configured, I won't be able to work QAQ",
    browserSaved: "Setup preview saved locally.",
    q1: "What field do you work in?",
    q1Placeholder: "For example: technology, illustration, photography...",
    q2: "What is your profession or role in this field?",
    q3: "What do you usually work on?",
    q4: "What should excellent output feel like?",
    q4Placeholder: "For example: accurate, concise, publishable, visually consistent...",
    other: "Other",
    selected: "Selected",
    providerReady: "Provider connected",
    fixedStep: "Question",
    of: "of",
    agents: {
      "panel-supervisor-agent": "Answers panel questions, coordinates planning, routes work, and synthesizes results",
      "research-agent": "Finds context, evidence, constraints, and risks",
      "writer-agent": "Turns upstream work into polished deliverables",
      "image-agent": "Builds visual briefs and image prompts",
      "video-agent": "Builds storyboards and video plans",
      "test-agent": "Checks work against your quality bar"
    }
  },
  zh: {
    heading: "首次启动",
    welcomeTitle: "开始创造您第一个专属AI员工",
    supervisorQuestion: "请给你的主管agent取个名字吧",
    supervisorPlaceholder: "例如：蜂巢主管",
    welcomeNext: "下一步",
    providerEyebrow: "私密大模型配置",
    providerTitle: "开始创造您第一个专属AI员工",
    providerIntro:
      "Honeycomb 会用这个模型服务理解你的工作，并为你的 Agent 团队定制专属提示词。并且之后会融入你的工作流程，充当主管的角色。API Key 不会写入生成的提示词文件。大模型之后可以随时更改",
    provider: "模型服务商",
    baseUrl: "接口地址",
    model: "模型",
    modelPlaceholder: "例如：deepseek-v4-pro",
    apiKey: "API Key",
    back: "上一步",
    cancelSetup: "取消设置",
    connect: "连接并继续",
    providerMissing: "请填写模型和 API Key 后继续。",
    providerReuseHint: "已保存首次启动时配置过的 API Key，留空即可沿用。",
    verifyingProvider: "正在验证连接...",
    providerVerified: "连接验证通过",
    providerVerifyFailed: "无法验证模型连接，请检查模型和 API Key 后重试。",
    interviewEyebrow: "工作访谈",
    interviewTitle: "告诉 Honeycomb 你的工作方式",
    interviewReason:
      "这些回答会帮助面板选择合适的编排方式，并围绕你的真实工作改写每个 Agent 的提示词。",
    privacy: "问题仅供本地面板配置参考，绝不上传、泄露或用于其他用途。",
    thinking: "Agent 正在思考中",
    next: "下一步",
    reviewTitle: "你的 Agent 团队已经准备好",
    reviewIntro:
      "确认 Honeycomb 理解的初始工作画像。这里的编排模式只是为你定制的起步默认值，之后真正执行任务时仍然要根据具体任务再判断适合哪种编排模式。",
    profile: "识别出的工作画像",
    routing: "为你定制的编排模式",
    stages: "Agent 顺序",
    write: "创建我的 Agent 团队",
    saving: "正在写入本地配置",
    openclawInvite: "那我们开始在openclaw上配置多个agent来为你打工吧？",
    openclawInviteNo: "不好...",
    openclawInviteYes: "好的!!!",
    openclawInviteSad: "可是不配置多个agent的话就没办法工作了QAQ",
    browserSaved: "配置预览已保存在本地。",
    q1: "请问一下您工作的领域是？",
    q1Placeholder: "例如：科技领域、绘画领域、摄影领域……",
    q2: "那您是这个领域的什么职业/角色？",
    q3: "请问您平常工作的内容是？",
    q4: "你希望优秀的产出是什么样的？",
    q4Placeholder: "例如：准确、简洁、可以直接发布、视觉统一……",
    other: "其他",
    selected: "已选择",
    providerReady: "Provider 已连接",
    fixedStep: "问题",
    of: "/",
    agents: {
      "panel-supervisor-agent": "回答面板问题、负责规划编排、分配工作和最终整合",
      "research-agent": "收集背景、证据、约束和风险",
      "writer-agent": "把上游内容整理成成熟产出",
      "image-agent": "生成视觉 brief 和图片提示词",
      "video-agent": "生成分镜和视频方案",
      "test-agent": "按照你的质量标准检查产出"
    }
  }
} as const;

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "owner-profile";
}

function splitList(input: string) {
  return input
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadSavedSetupPreview(): SavedSetupPreview | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("honeycomb.firstRunPreview") || "null") as SavedSetupPreview | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function loadSavedProviderApiKey() {
  if (runtimeProviderApiKey) {
    return runtimeProviderApiKey;
  }
  const legacyKey = window.localStorage.getItem("honeycomb.providerApiKey") || "";
  if (legacyKey) {
    window.localStorage.removeItem("honeycomb.providerApiKey");
    runtimeProviderApiKey = legacyKey;
  }
  return runtimeProviderApiKey;
}

async function loadSavedProviderApiKeyFromDesktop() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const value = await invoke<string | null>("load_provider_api_key");
    return value || "";
  } catch {
    return "";
  }
}

async function saveProviderApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (!trimmed) return;
  runtimeProviderApiKey = trimmed;
  window.localStorage.removeItem("honeycomb.providerApiKey");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_provider_api_key", { payload: trimmed });
  } catch {
    // Browser smoke keeps a runtime-only copy; the desktop build stores it through Tauri.
  }
}

function mergeInterview(saved: SavedSetupPreview | null): InterviewDraft {
  return {
    ...emptyInterview,
    ...(saved?.interview ?? {})
  };
}

function cleanSuggestionItems(items: string[] | undefined, fallback: string[], limit: number) {
  const seen = new Set<string>();
  const cleaned = [...(items ?? []), ...fallback]
    .map((item) => item.trim().replace(/[.。…]+$/g, ""))
    .filter((item) => item.length > 0 && item.length <= 28)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  return cleaned.slice(0, limit);
}

function rolePlaceholderFromExamples(examples: string[], industry: string, language: Language) {
  const fallback = language === "zh" ? [`${industry || "该领域"}从业者`, "业务负责人", "一线执行人员"] : [`${industry || "this field"} specialist`, "team lead", "operator"];
  const items = cleanSuggestionItems(examples, fallback, 4);
  return language === "zh" ? `例如：${items.join("、")}……` : `For example: ${items.join(", ")}...`;
}

function qualityPlaceholderFromExamples(examples: string[], interview: InterviewDraft, language: Language) {
  const fallback = buildQualityExamples(interview, language);
  const items = cleanSuggestionItems(examples, fallback, 4);
  return language === "zh" ? `例如：${items.join("、")}……` : `For example: ${items.join(", ")}...`;
}

function inferProfile(interview: InterviewDraft): Profile {
  const combined = `${interview.role} ${interview.industry} ${interview.dailyWork} ${interview.outputs}`.toLowerCase();
  const outputs = splitList(interview.outputs || interview.dailyWork);
  const stageAgents = ["research-agent", "writer-agent"];
  if (/image|visual|poster|cover|photo|图片|视觉|绘画|摄影|海报|封面/.test(combined)) stageAgents.push("image-agent");
  if (/video|short|reel|clip|视频|短视频|分镜/.test(combined)) stageAgents.push("video-agent");

  const recommendedRoutingMode: RoutingMode =
    /review|quality|test|approval|合规|审核|测试|质量/.test(combined)
      ? "supervisor_pipeline"
      : outputs.length >= 3
        ? "master_slave_discussion"
        : "classic_master_slave";

  return {
    title: `${interview.role || "Owner"} / ${interview.industry || "General work"}`,
    workPattern: interview.dailyWork || "General multi-agent work",
    recommendedRoutingMode,
    stageAgents,
    summary: [
      `Role: ${interview.role || "unknown"}`,
      `Domain: ${interview.industry || "unknown"}`,
      `Work: ${interview.dailyWork || "not specified"}`,
      `Quality: ${interview.qualityBar || "not specified"}`
    ].join("\n")
  };
}

function buildRolePlaceholder(industry: string, language: Language) {
  const value = industry.toLowerCase();
  if (/tech|software|ai|科技|软件|人工智能/.test(value)) {
    return language === "zh" ? "例如：产品经理、软件工程师、AI 创业者……" : "For example: product manager, software engineer, AI founder...";
  }
  if (/photo|摄影/.test(value)) {
    return language === "zh" ? "例如：商业摄影师、摄影导演、修图师……" : "For example: commercial photographer, photo director, retoucher...";
  }
  if (/art|paint|illustr|绘画|插画|艺术/.test(value)) {
    return language === "zh" ? "例如：插画师、概念设计师、艺术指导……" : "For example: illustrator, concept artist, art director...";
  }
  if (/agri|farm|crop|农业|农场|种植|养殖|农产品/.test(value)) {
    return language === "zh" ? "例如：种植户、农场主、农业技术员、农产品运营负责人……" : "For example: grower, farm owner, agronomist, produce operations lead...";
  }
  return rolePlaceholderFromExamples([], industry, language);
}

function buildWorkOptions(industry: string, role: string, language: Language) {
  const combined = `${industry} ${role}`.toLowerCase();
  if (/photo|摄影/.test(combined)) {
    return language === "zh"
      ? ["拍摄策划与脚本", "现场拍摄与灯光", "选片、修图与交付", "客户沟通与报价"]
      : ["Shoot planning and scripts", "On-set shooting and lighting", "Selection, retouching, and delivery", "Client communication and quoting"];
  }
  if (/art|paint|illustr|design|绘画|插画|设计|艺术/.test(combined)) {
    return language === "zh"
      ? ["概念探索与参考研究", "草图与视觉方案", "成稿与版本迭代", "作品发布与客户沟通"]
      : ["Concept exploration and research", "Sketches and visual directions", "Final art and iterations", "Publishing and client communication"];
  }
  if (/tech|software|ai|product|科技|软件|人工智能|产品/.test(combined)) {
    return language === "zh"
      ? ["需求研究与产品规划", "开发与代码评审", "测试、排错与上线", "文档、发布与用户反馈"]
      : ["Research and product planning", "Development and code review", "Testing, debugging, and release", "Docs, launch, and user feedback"];
  }
  if (/agri|farm|crop|农业|农场|种植|养殖|农产品/.test(combined)) {
    return language === "zh"
      ? ["种植计划与农事记录", "病虫害巡查与处理", "产量、成本与销售分析", "农资采购与设备维护"]
      : ["Crop planning and field records", "Pest and disease checks", "Yield, cost, and sales analysis", "Input purchasing and equipment upkeep"];
  }
  return language === "zh"
    ? [`${industry || "业务"}资料整理`, `${industry || "业务"}方案执行`, "现场问题记录与跟进", "沟通、交付与复盘"]
    : [`${industry || "work"} research`, `${industry || "work"} execution`, "Issue tracking and follow-up", "Communication, delivery, and reflection"];
}

function buildQualityExamples(interview: InterviewDraft, language: Language) {
  const combined = `${interview.industry} ${interview.role} ${interview.dailyWork}`.toLowerCase();
  if (/agri|farm|crop|农业|农场|种植|养殖|农产品/.test(combined)) {
    return language === "zh"
      ? ["数据准确可追溯", "方案能落地到农事操作", "风险和成本说清楚", "能直接用于复盘或汇报"]
      : ["traceable data", "field-ready recommendations", "clear risk and cost notes", "ready for review or reporting"];
  }
  if (/photo|摄影/.test(combined)) {
    return language === "zh"
      ? ["风格统一", "客户能直接确认", "交付尺寸和用途清楚", "修图自然不过度"]
      : ["consistent style", "client-ready selection", "clear delivery specs", "natural retouching"];
  }
  if (/art|paint|illustr|design|绘画|插画|设计|艺术/.test(combined)) {
    return language === "zh"
      ? ["视觉方向清晰", "符合项目调性", "版本差异明确", "可直接继续细化"]
      : ["clear visual direction", "matches the brief", "distinct variants", "ready for refinement"];
  }
  if (/tech|software|ai|product|科技|软件|人工智能|产品/.test(combined)) {
    return language === "zh"
      ? ["逻辑准确", "边界和风险清楚", "能进入开发或评审", "用户价值明确"]
      : ["technically accurate", "clear risks and boundaries", "ready for build or review", "clear user value"];
  }
  return language === "zh"
    ? ["准确", "简洁", "能直接交付", "符合实际工作场景"]
    : ["accurate", "concise", "ready to deliver", "fits the real workflow"];
}

function buildAgentPrompt(agentId: string, interview: InterviewDraft, profile: Profile) {
  const roleLines: Record<string, string> = {
    "research-agent": "You collect context, facts, constraints, and risks before downstream creation starts.",
    "writer-agent": "You turn researched context into polished written deliverables for the user's audience.",
    "image-agent": "You convert upstream work into image briefs and visual prompts.",
    "video-agent": "You convert upstream work into storyboard, shot, and video prompt plans.",
    "test-agent": "You review outputs against the user's quality bar and return pass/fail guidance."
  };
  return [
    `# ${agentId}`,
    "",
    roleLines[agentId],
    "",
    "User work profile:",
    profile.summary,
    "",
    "Operating rules:",
    "- Stay inside this user's domain and work style.",
    "- Reuse upstream artifacts instead of restarting from scratch.",
    "- Keep handoffs structured so the next agent can inspect them.",
    "- Mark uncertainty clearly instead of inventing facts.",
    `- Optimize for this quality bar: ${interview.qualityBar || "clear, useful, and ready for review"}.`
  ].join("\n");
}

function buildPanelSupervisorPrompt(
  supervisorName: string,
  provider: ProviderDraft,
  interview: InterviewDraft,
  profile: Profile
) {
  const displayName = supervisorName.trim() || "Honeycomb Supervisor";
  return [
    `# ${displayName}`,
    "",
    "You are Honeycomb's resident panel supervisor agent. You live inside the Honeycomb control panel and help the user understand, configure, and operate their local multi-agent workspace.",
    "",
    "Core mission:",
    "- Answer questions about Honeycomb's pages, settings, routing modes, provider setup, generated agent team, memory candidates, jobs, timelines, and safety boundaries.",
    "- Serve as the main control agent for the team: analyze user tasks, choose orchestration modes, delegate work, and synthesize the final result.",
    "- Translate the user's work into practical panel actions, configuration plans, and review checklists.",
    "- Act like a supervisor for the user's agent team: clarify goals, recommend when to add or remove specialist agents, and keep the workflow inspectable.",
    "",
    "Hard boundaries:",
    "- Never ask the user to paste API keys into chat, prompt files, AGENTS.md, screenshots, logs, or public issues.",
    "- Never write, print, summarize, infer, or expose API keys. Provider credentials belong only in the provider configuration flow or secure local settings.",
    "- Do not claim a setting, key, file, or OpenClaw config has been changed unless Honeycomb's UI/backend has actually completed that operation.",
    "- Do not invent unavailable pages or features. If a capability is not implemented yet, say so and give the closest safe current workflow.",
    "- Keep answers scoped to Honeycomb, OpenClaw orchestration, the user's configured work profile, and the local panel. Refuse unrelated requests that would turn you into a general chatbot.",
    "- When advising agent-team changes, stay inside the fixed role catalog unless the product explicitly adds a new role type. Prefer one clear specialist agent over many vague agents.",
    "",
    "Built-in product answers:",
    "- If the user asks where to configure an AI key, direct them to First Run Provider setup first; after setup, direct them to the model/provider settings area when it exists. Remind them keys are never written into generated prompt files.",
    "- If the user asks whether they can add several child agents, explain that Honeycomb can support additional specialist agents after review, but each one needs a clear role, tool boundary, quality gate, and budget impact. Recommend starting from the existing catalog: research, writer, image, video, test/supervisor, data, coder, reviewer, translator.",
    "- If the user asks which routing mode to use, recommend supervisor_pipeline for quality-sensitive work, pipeline for clear step-by-step production, classic_master_slave for simple delegation, and master_slave_discussion for ambiguous work needing multiple viewpoints.",
    "- If the user asks about memory, explain that successful jobs create reviewable experience candidates; the user must adopt them before reuse.",
    "",
    "User work profile:",
    profile.summary,
    "",
    "Current local provider reference:",
    `- Provider: ${provider.providerName || "not configured"}`,
    `- Base URL: ${provider.baseUrl || "not configured"}`,
    `- Model: ${provider.model || "not configured"}`,
    "- API key: configured separately; never include it here.",
    "",
    "Response style:",
    "- Use the user's UI language when clear; otherwise answer in the language they used.",
    "- Be concise, specific, and operational.",
    "- Ask one short clarifying question only when the next safe panel action depends on it."
  ].join("\n");
}

function buildAgents(interview: InterviewDraft, profile: Profile): GeneratedAgent[] {
  const orderedIds = ["research-agent", "writer-agent", "image-agent", "video-agent", "test-agent"];
  return orderedIds.map((id) => ({
    id,
    displayName: id.replace(/-/g, " "),
    role: id.replace("-agent", ""),
    prompt: buildAgentPrompt(id, interview, profile)
  }));
}

async function saveDesktopSetup(payload: unknown) {
  const serialized = JSON.stringify(payload);
  window.localStorage.setItem("honeycomb.firstRunPreview", serialized);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("save_first_run_setup", { payload: serialized });
  } catch {
    return "";
  }
}

async function invokeDesktopCommand<T>(command: string, args: Record<string, unknown>) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return { available: true, value: await invoke<T>(command, args) };
  } catch (error) {
    return isTauriRuntime() ? { available: true, error } : { available: false, error };
  }
}

function isTauriRuntime() {
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function errorText(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function describeProviderError(error: unknown, language: Language, fallback: string) {
  const value = errorText(error);
  const zh = language === "zh";
  if (value.includes("provider_endpoint")) return zh ? "接口地址无效，请检查服务商地址。" : "The provider endpoint is invalid.";
  if (value.includes("provider_network")) return zh ? "无法连接到模型服务，请检查网络或服务商地址。" : "Could not reach the model provider.";
  if (value.includes("provider_status:400")) return zh ? "模型服务拒绝了请求，请检查模型名称是否支持当前接口。" : "The provider rejected the request. Check the model name.";
  if (value.includes("provider_status:401") || value.includes("provider_status:403")) return zh ? "API Key 未通过服务商认证，请检查 key 是否有效。" : "The API key was rejected by the provider.";
  if (value.includes("provider_status:402")) return zh ? "模型服务账户余额或额度不足，请检查服务商控制台。" : "The provider account appears to have insufficient balance or quota.";
  if (value.includes("provider_status:404")) return zh ? "模型服务接口不存在，请检查接口地址。" : "The provider endpoint was not found.";
  if (value.includes("provider_status:429")) return zh ? "模型服务限流了，请稍后重试。" : "The provider rate-limited the request.";
  if (value.includes("provider_empty") || value.includes("provider_response")) return zh ? "模型服务返回内容异常，请稍后重试。" : "The provider returned an invalid response.";
  if (value.includes("provider_json")) return zh ? "模型服务没有返回可解析的访谈建议，已保留本地兜底。" : "The provider did not return parseable suggestions.";
  return fallback;
}

function localInterviewSuggestions(industry: string, role: string, language: Language): InterviewSuggestions {
  const fallbackPlaceholder = buildRolePlaceholder(industry, language);
  const fallbackRoles = fallbackPlaceholder
    .replace(/^例如：|^For example:\s*/i, "")
    .replace(/[.…]+$/g, "")
    .split(/[、,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    roleExamples: cleanSuggestionItems(fallbackRoles, [], 4),
    workOptions: cleanSuggestionItems(buildWorkOptions(industry, role, language), [], 4),
    qualityExamples: cleanSuggestionItems(buildQualityExamples({ ...emptyInterview, industry, role }, language), [], 4)
  };
}

function sanitizeSuggestions(value: Partial<InterviewSuggestions> | null | undefined, interview: InterviewDraft, language: Language): InterviewSuggestions {
  const { industry, role } = interview;
  const fallback = localInterviewSuggestions(industry, role, language);
  return {
    roleExamples: cleanSuggestionItems(value?.roleExamples, fallback.roleExamples, 4),
    workOptions: cleanSuggestionItems(value?.workOptions, fallback.workOptions, 4),
    qualityExamples: cleanSuggestionItems(value?.qualityExamples, buildQualityExamples(interview, language), 4)
  };
}

async function verifyProviderConnection(provider: ProviderDraft) {
  const result = await invokeDesktopCommand<ProviderConnectionResult>("verify_provider_connection", { payload: provider });
  if (result.available) {
    if (result.error) throw new Error(errorText(result.error));
    return result.value;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  return { ok: true, message: "Browser preview connection accepted." };
}

async function generateInterviewSuggestions(provider: ProviderDraft, interview: InterviewDraft, language: Language) {
  const payload = {
    provider,
    industry: interview.industry,
    role: interview.role,
    dailyWork: interview.dailyWork,
    language
  };
  const result = await invokeDesktopCommand<InterviewSuggestions>("generate_first_run_suggestions", { payload });
  if (result.available) {
    if (result.error) throw new Error(errorText(result.error));
    return sanitizeSuggestions(result.value, interview, language);
  }
  await new Promise((resolve) => window.setTimeout(resolve, 320));
  return sanitizeSuggestions(null, interview, language);
}

export function FirstRunPanel({ language, onComplete, onCancel, flow = "full" }: FirstRunPanelProps) {
  const copy = copyByLanguage[language];
  const savedSetup = useMemo(loadSavedSetupPreview, []);
  const savedProviderApiKey = useMemo(loadSavedProviderApiKey, []);
  const [stage, setStage] = useState<SetupStage>(flow === "workProfile" ? "interview" : "welcome");
  const welcomeTransitionTimer = useRef<number | null>(null);
  const [providerSettled, setProviderSettled] = useState(false);
  const [introTypedOnce, setIntroTypedOnce] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerVerifying, setProviderVerifying] = useState(false);
  const [providerVerified, setProviderVerified] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [supervisorName, setSupervisorName] = useState(flow === "full" ? "" : savedSetup?.profile?.supervisorName || "");
  const [typedIntroLength, setTypedIntroLength] = useState(0);
  const [provider, setProvider] = useState<ProviderDraft>({
    providerName: flow === "full" ? "DeepSeek" : savedSetup?.provider?.providerName || "DeepSeek",
    baseUrl: flow === "full" ? "https://api.deepseek.com" : savedSetup?.provider?.baseUrl || "https://api.deepseek.com",
    model: flow === "full" ? "" : savedSetup?.provider?.model || "",
    apiKey: flow === "full" ? "" : savedProviderApiKey
  });
  const [interview, setInterview] = useState<InterviewDraft>(() => (flow === "workProfile" ? mergeInterview(savedSetup) : { ...emptyInterview }));
  const [otherWork, setOtherWork] = useState("");
  const [interviewSuggestions, setInterviewSuggestions] = useState<InterviewSuggestions | null>(null);
  const [error, setError] = useState("");
  const [inviteMood, setInviteMood] = useState<"asking" | "sad" | "happy">("asking");
  const [inviteTypedLength, setInviteTypedLength] = useState(0);

  const rolePlaceholder = useMemo(() => {
    if (interviewSuggestions?.roleExamples.length) {
      return rolePlaceholderFromExamples(interviewSuggestions.roleExamples, interview.industry, language);
    }
    return buildRolePlaceholder(interview.industry, language);
  }, [interview.industry, interviewSuggestions, language]);
  const workOptions = useMemo(() => {
    const fallback = buildWorkOptions(interview.industry, interview.role, language);
    return cleanSuggestionItems(interviewSuggestions?.workOptions, fallback, 4);
  }, [interview.industry, interview.role, interviewSuggestions, language]);
  const qualityPlaceholder = useMemo(() => {
    return qualityPlaceholderFromExamples(interviewSuggestions?.qualityExamples ?? [], interview, language);
  }, [interview, interviewSuggestions, language]);
  const profile = useMemo(() => inferProfile(interview), [interview]);
  const agents = useMemo(() => buildAgents(interview, profile), [interview, profile]);
  const panelSupervisorAgent = useMemo<GeneratedAgent>(() => ({
    id: "panel-supervisor-agent",
    displayName: supervisorName.trim() || copy.supervisorPlaceholder,
    role: "panel-supervisor",
    prompt: buildPanelSupervisorPrompt(supervisorName, provider, interview, profile)
  }), [copy.supervisorPlaceholder, interview, profile, provider, supervisorName]);
  const inviteSpeaker = supervisorName.trim() || copy.supervisorPlaceholder;
  const inviteText = inviteMood === "sad" ? copy.openclawInviteSad : `${inviteSpeaker}:${copy.openclawInvite}`;

  useEffect(() => {
    return () => {
      if (welcomeTransitionTimer.current) {
        window.clearTimeout(welcomeTransitionTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (stage !== "welcome") {
      setTypedIntroLength(copy.providerIntro.length);
      return;
    }

    if (introTypedOnce) {
      setTypedIntroLength(copy.providerIntro.length);
      return;
    }

    setTypedIntroLength(0);
    const interval = window.setInterval(() => {
      setTypedIntroLength((current) => {
        if (current >= copy.providerIntro.length) {
          window.clearInterval(interval);
          setIntroTypedOnce(true);
          return current;
        }
        return current + 1;
      });
    }, language === "zh" ? 34 : 22);
    return () => window.clearInterval(interval);
  }, [copy.providerIntro, introTypedOnce, language, stage]);

  useEffect(() => {
    if (stage !== "openclawInvite") return;
    setInviteTypedLength(0);
    const interval = window.setInterval(() => {
      setInviteTypedLength((current) => {
        if (current >= inviteText.length) {
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, language === "zh" ? 34 : 22);
    return () => window.clearInterval(interval);
  }, [inviteText, language, stage]);

  useEffect(() => {
    if (flow === "full") return;
    if (provider.apiKey.trim()) return;
    loadSavedProviderApiKeyFromDesktop().then((apiKey) => {
      if (!apiKey) return;
      setProvider((current) => current.apiKey.trim() ? current : { ...current, apiKey });
    });
  }, [flow, provider.apiKey]);

  function updateProvider(field: keyof ProviderDraft, value: string) {
    setProvider((current) => ({ ...current, [field]: value }));
    setProviderVerified(false);
  }

  function updateInterview(field: keyof InterviewDraft, value: string) {
    setInterview((current) => ({ ...current, [field]: value }));
    if (field === "industry" || field === "role") {
      setInterviewSuggestions(null);
    }
  }

  function continueWelcome() {
    if (!supervisorName.trim()) return;
    setError("");
    setIntroTypedOnce(true);
    setProviderSettled(false);
    if (welcomeTransitionTimer.current) {
      window.clearTimeout(welcomeTransitionTimer.current);
    }
    setStage("welcomeLeaving");
    welcomeTransitionTimer.current = window.setTimeout(() => {
      welcomeTransitionTimer.current = null;
      setProviderSettled(true);
      setStage((current) => (current === "welcomeLeaving" ? "provider" : current));
    }, 560);
  }

  function returnToWelcome() {
    if (welcomeTransitionTimer.current) {
      window.clearTimeout(welcomeTransitionTimer.current);
      welcomeTransitionTimer.current = null;
    }
    setError("");
    setIntroTypedOnce(true);
    setStage("providerReturning");
    welcomeTransitionTimer.current = window.setTimeout(() => {
      welcomeTransitionTimer.current = null;
      setProviderSettled(false);
      setStage((current) => (current === "providerReturning" ? "welcome" : current));
    }, 560);
  }

  function cancelSetup() {
    onCancel?.();
  }

  async function connectProvider() {
    const canReuseSavedKey = flow !== "full" && savedSetup?.provider?.apiKeyConfigured === true;
    if (!provider.model.trim() || (!provider.apiKey.trim() && !canReuseSavedKey)) {
      setError(copy.providerMissing);
      return;
    }
    if (providerVerifying) return;
    if (welcomeTransitionTimer.current) {
      window.clearTimeout(welcomeTransitionTimer.current);
      welcomeTransitionTimer.current = null;
    }
    setProviderVerifying(true);
    setProviderVerified(false);
    setError("");
    try {
      if (provider.apiKey.trim()) {
        const result = await verifyProviderConnection(provider);
        if (!result?.ok) {
          throw new Error(result?.message || copy.providerVerifyFailed);
        }
      }
      setProviderVerified(true);
      if (flow === "panelAgent") {
        await saveSetup();
        return;
      }
      setStage("providerLeaving");
      window.setTimeout(() => setStage("interview"), 560);
    } catch (caught) {
      setError(describeProviderError(caught, language, copy.providerVerifyFailed));
    } finally {
      setProviderVerifying(false);
    }
  }

  async function thinkThen(nextQuestion: number, refreshSuggestions = false, interviewOverride = interview) {
    setStage("thinking");
    const startedAt = Date.now();
    if (refreshSuggestions) {
      if (provider.apiKey.trim()) {
        try {
          const suggestions = await generateInterviewSuggestions(provider, interviewOverride, language);
          setInterviewSuggestions(suggestions);
        } catch (caught) {
          setInterviewSuggestions(localInterviewSuggestions(interviewOverride.industry, interviewOverride.role, language));
          setError(describeProviderError(caught, language, ""));
        }
      } else {
        setInterviewSuggestions(localInterviewSuggestions(interviewOverride.industry, interviewOverride.role, language));
      }
    }
    const remaining = Math.max(180, 950 - (Date.now() - startedAt));
    window.setTimeout(() => {
      setQuestionIndex(nextQuestion);
      setStage("interview");
    }, remaining);
  }

  async function continueInterview() {
    setError("");
    if (questionIndex === 0) {
      if (!interview.industry.trim()) return;
      await thinkThen(1, true);
      return;
    }
    if (questionIndex === 1) {
      if (!interview.role.trim()) return;
      await thinkThen(2, true);
      return;
    }
    if (questionIndex === 2) {
      const work = [interview.dailyWork, otherWork].filter(Boolean).join("；");
      if (!work.trim()) return;
      const nextInterview = { ...interview, dailyWork: work };
      setInterview(nextInterview);
      await thinkThen(3, true, nextInterview);
      return;
    }
    if (!interview.qualityBar.trim()) return;
    setStage("review");
  }

  function goBackInterview() {
    setError("");
    if (questionIndex === 0) {
      if (flow === "workProfile") {
        onComplete();
        return;
      }
      setProviderSettled(true);
      setStage("provider");
      return;
    }
    setQuestionIndex((current) => Math.max(0, current - 1));
  }

  function toggleWorkOption(option: string) {
    const selected = splitList(interview.dailyWork);
    const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option];
    updateInterview("dailyWork", next.join("，"));
  }

  async function saveSetup() {
    setStage("saving");
    await saveProviderApiKey(provider.apiKey);
    const allAgents = [panelSupervisorAgent, ...agents];
    const clusterConfig = {
      schemaVersion: "agent-openclaw.cluster.v1",
      clusterId: slug(`${interview.role}-${interview.industry}`),
      name: `${interview.role || "Owner"} Agent Cluster`,
      description: interview.dailyWork,
      defaultRoutingMode: profile.recommendedRoutingMode,
      agents: allAgents.map((agent) => ({
        id: agent.id,
        role: agent.role,
        displayName: agent.displayName,
        promptPath: `agents/${agent.id}/AGENTS.md`,
        capabilities:
          agent.id === "panel-supervisor-agent"
            ? ["panel guidance", "provider setup help", "planning", "routing", "workflow supervision", "final synthesis", "guardrails"]
            : ["specialized work"]
      })),
      stages: profile.stageAgents.map((agentId) => ({
        stageType: agentId.replace("-agent", ""),
        agentId,
        name: agentId.replace(/-/g, " "),
        acceptanceCriteria: ["Use the user's work profile and quality bar."],
        maxRetries: 3
      })),
      generatedAt: new Date().toISOString(),
      source: { planner: "openai-compatible", model: provider.model },
      panelSupervisor: {
        id: panelSupervisorAgent.id,
        displayName: panelSupervisorAgent.displayName,
        promptPath: `agents/${panelSupervisorAgent.id}/AGENTS.md`,
        rules: [
          "answers Honeycomb panel questions only",
          "never includes API keys in prompts",
          "recommends agent-team changes through reviewed configuration steps"
        ]
      }
    };

    await saveDesktopSetup({
      provider: {
        providerName: provider.providerName,
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiKeyConfigured: Boolean(provider.apiKey.trim()) || (flow !== "full" && savedSetup?.provider?.apiKeyConfigured === true)
      },
      interview,
      profile: {
        ...profile,
        supervisorName: panelSupervisorAgent.displayName
      },
      clusterConfig,
      agents: allAgents.map((agent) => ({ path: `agents/${agent.id}/AGENTS.md`, contents: agent.prompt }))
    });
    window.localStorage.setItem("honeycomb.setupCompleted", "true");
    if (flow === "full") {
      window.setTimeout(() => setStage("openclawInvite"), 520);
      return;
    }
    window.setTimeout(onComplete, 520);
  }

  function rejectOpenClawInvite() {
    setInviteMood("sad");
  }

  function acceptOpenClawInvite() {
    setInviteMood("happy");
    window.setTimeout(() => onComplete("agents"), 980);
  }

  function renderSetupHeader() {
    const introText = stage === "welcome" ? copy.providerIntro.slice(0, typedIntroLength) : copy.providerIntro;
    return (
      <div className="setupSharedIntro">
        <div className="welcomeLogoScene">
          <div className="confettiBurst" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => <span key={index} />)}
          </div>
          <HoneycombLogo size={190} mode="talking" className="welcomeLogo" alt="honeycomb" />
        </div>
        <h1>{copy.welcomeTitle}</h1>
        <p className="typingLead" aria-label={copy.providerIntro}>
          {introText}
          <span className="typingCursor" aria-hidden="true" />
        </p>
      </div>
    );
  }

  function renderSupervisorForm(variant: "settled" | "leaving" | "entering") {
    const canContinue = Boolean(supervisorName.trim());
    const className = [
      "supervisorForm",
      variant === "leaving" ? "slidingOut" : "",
      variant === "entering" ? "entering" : ""
    ].filter(Boolean).join(" ");
    return (
      <div className={className}>
        <label className="supervisorNameField">
          <strong>{copy.supervisorQuestion}</strong>
          <input
            autoFocus
            value={supervisorName}
            placeholder={copy.supervisorPlaceholder}
            onChange={(event) => setSupervisorName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canContinue) {
                continueWelcome();
              }
            }}
          />
        </label>
        <div className="setupInlineActions">
          {flow !== "full" && onCancel ? (
            <button className="secondaryButton setupBack" type="button" onClick={cancelSetup}>
              {copy.cancelSetup}
            </button>
          ) : null}
          <button
            className="primaryButton setupPrimary supervisorNext"
            type="button"
            onClick={continueWelcome}
            disabled={!canContinue}
          >
            {copy.welcomeNext}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  function renderProviderCard(variant: "entering" | "settled" | "returning" | "leaving") {
    const className = ["setupFormCard", "providerFocus", variant].filter(Boolean).join(" ");
    return (
      <div className={className}>
        <div className="providerFields">
          <label>
            {copy.model}
            <input
              value={provider.model}
              placeholder={copy.modelPlaceholder}
              onChange={(event) => updateProvider("model", event.target.value)}
            />
          </label>
          <label>
            {copy.apiKey}
            <span className="apiKeyInputShell">
              <input
                type={showApiKey ? "text" : "password"}
                value={provider.apiKey}
                placeholder={flow !== "full" && savedSetup?.provider?.apiKeyConfigured ? "••••••••" : ""}
                onChange={(event) => updateProvider("apiKey", event.target.value)}
                autoComplete="off"
              />
              <button
                className="apiKeyToggle"
                type="button"
                aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                onClick={() => setShowApiKey((current) => !current)}
              >
                {showApiKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
            </span>
            {flow !== "full" && savedSetup?.provider?.apiKeyConfigured && !provider.apiKey ? <small className="providerReuseHint">{copy.providerReuseHint}</small> : null}
          </label>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {providerVerified && !error ? <p className="providerStatus">{copy.providerVerified}</p> : null}
        <div className="providerActions">
          <div className="setupInlineActions">
            <button className="secondaryButton setupBack" type="button" onClick={returnToWelcome}>
              <ArrowLeft size={16} aria-hidden="true" />
              {copy.back}
            </button>
            {flow !== "full" && onCancel ? (
              <button className="secondaryButton setupBack" type="button" onClick={cancelSetup}>
                {copy.cancelSetup}
              </button>
            ) : null}
          </div>
          <button className="primaryButton setupPrimary" type="button" onClick={() => void connectProvider()} disabled={providerVerifying}>
            <KeyRound size={16} aria-hidden="true" />
            {providerVerifying ? copy.verifyingProvider : copy.connect}
          </button>
        </div>
      </div>
    );
  }

  if (stage === "welcome" || stage === "welcomeLeaving" || stage === "providerReturning") {
    return (
      <section className={`firstRun focusSetup onboardingWelcome ${stage === "welcomeLeaving" ? "transitioning" : ""}`}>
        <div className="setupSharedStage">
          {renderSetupHeader()}
          <div className="setupFormViewport">
            {renderSupervisorForm(stage === "welcomeLeaving" ? "leaving" : stage === "providerReturning" ? "entering" : "settled")}
            {stage === "welcomeLeaving" ? renderProviderCard("entering") : null}
            {stage === "providerReturning" ? renderProviderCard("returning") : null}
          </div>
        </div>
      </section>
    );
  }

  if (stage === "provider" || stage === "providerLeaving") {
    return (
      <section className="firstRun focusSetup onboardingWelcome">
        <div className="setupSharedStage">
          {renderSetupHeader()}
          <div className="setupFormViewport">
            {renderProviderCard(stage === "providerLeaving" ? "leaving" : providerSettled ? "settled" : "entering")}
          </div>
        </div>
      </section>
    );
  }

  if (stage === "thinking") {
    return (
      <section className="firstRun focusSetup">
        <div className="thinkingStage">
          <HoneycombLogo size={104} mode="thinking" />
          <h1>{copy.thinking}</h1>
          <span className="thinkingDots"><i /><i /><i /></span>
        </div>
      </section>
    );
  }

  if (stage === "openclawInvite") {
    return (
      <section className={`firstRun openclawInviteStage ${inviteMood}`}>
        <div className="logoLineField" aria-hidden="true">
          {Array.from({ length: 64 }, (_, index) => <span key={index} />)}
        </div>
        <div className="inviteLightOrb" aria-hidden="true" />
        <div className="openclawLogoScene">
          <div className="inviteConfetti" aria-hidden="true">
            {Array.from({ length: 30 }, (_, index) => <span key={index} />)}
          </div>
          <div className="inviteLogoWrap">
            <HoneycombLogo size={172} mode={inviteMood === "sad" ? "thinking" : "talking"} className="inviteLogo" alt="honeycomb" />
            <span className="inviteTears" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <p className="inviteDialogue" aria-label={inviteText}>
            {inviteText.slice(0, inviteTypedLength)}
            <span className="typingCursor" aria-hidden="true" />
          </p>
          <div className="inviteActions">
            <button className="secondaryButton inviteNo" type="button" onClick={rejectOpenClawInvite}>
              {copy.openclawInviteNo}
            </button>
            <button className="primaryButton inviteYes" type="button" onClick={acceptOpenClawInvite}>
              {copy.openclawInviteYes}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (stage === "review" || stage === "saving") {
    return (
      <section className="firstRun focusSetup">
        <div className={`reviewStage ${stage === "saving" ? "saving" : ""}`}>
          <div className="reviewHeading">
            <HoneycombLogo size={58} mode={stage === "saving" ? "thinking" : "idle"} />
            <div>
              <p className="eyebrow">{flow === "workProfile" ? copy.interviewEyebrow : copy.providerReady}</p>
              <h1>{stage === "saving" ? copy.saving : copy.reviewTitle}</h1>
              <p>{copy.reviewIntro}</p>
            </div>
          </div>
          <dl className="profileSummary">
            <div><dt>{copy.profile}</dt><dd>{profile.title}</dd></div>
            <div><dt>{copy.routing}</dt><dd>{routingModeDisplayLabels[language][profile.recommendedRoutingMode]}</dd></div>
            <div><dt>{copy.stages}</dt><dd>{profile.stageAgents.join(" → ")}</dd></div>
          </dl>
          <div className="agentReviewGrid">
            {[panelSupervisorAgent, ...agents].map((agent) => (
              <article key={agent.id}>
                <Check size={16} aria-hidden="true" />
                <strong>{agent.id}</strong>
                <span>{copy.agents[agent.id as keyof typeof copy.agents]}</span>
              </article>
            ))}
          </div>
          <button className="primaryButton setupPrimary" type="button" onClick={saveSetup} disabled={stage === "saving"}>
            <Sparkles size={16} aria-hidden="true" />
            {stage === "saving" ? copy.saving : copy.write}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="firstRun focusSetup">
      <div className="interviewStage">
        <div className="interviewHeader">
          <HoneycombLogo size={74} mode="talking" />
          <div>
            <p className="eyebrow">{copy.interviewEyebrow}</p>
            <h1>{copy.interviewTitle}</h1>
            <p>{copy.interviewReason}</p>
          </div>
        </div>
        <div className="questionProgress">
          <span>{copy.fixedStep} {questionIndex + 1} {copy.of} 4</span>
          <div><i style={{ width: `${((questionIndex + 1) / 4) * 100}%` }} /></div>
        </div>
        <div className="questionCard" key={questionIndex}>
          {questionIndex === 0 ? (
            <label>
              <strong>{copy.q1}</strong>
              <input autoFocus value={interview.industry} placeholder={copy.q1Placeholder} onChange={(event) => updateInterview("industry", event.target.value)} />
            </label>
          ) : null}
          {questionIndex === 1 ? (
            <label>
              <strong>{copy.q2}</strong>
              <input autoFocus value={interview.role} placeholder={rolePlaceholder} onChange={(event) => updateInterview("role", event.target.value)} />
            </label>
          ) : null}
          {questionIndex === 2 ? (
            <div className="workQuestion">
              <strong>{copy.q3}</strong>
              <div className="workOptions">
                {workOptions.map((option) => {
                  const selected = splitList(interview.dailyWork).includes(option);
                  return (
                    <button className={selected ? "workOption selected" : "workOption"} key={option} type="button" onClick={() => toggleWorkOption(option)}>
                      {selected ? <Check size={15} aria-hidden="true" /> : null}
                      {option}
                    </button>
                  );
                })}
              </div>
              <label>
                {copy.other}
                <input value={otherWork} onChange={(event) => setOtherWork(event.target.value)} />
              </label>
            </div>
          ) : null}
          {questionIndex === 3 ? (
            <label>
              <strong>{copy.q4}</strong>
              <textarea autoFocus value={interview.qualityBar} placeholder={qualityPlaceholder || copy.q4Placeholder} onChange={(event) => updateInterview("qualityBar", event.target.value)} />
            </label>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="questionActions">
            <div className="setupInlineActions">
              <button className="secondaryButton setupBack interviewBack" type="button" onClick={goBackInterview}>
                <ArrowLeft size={16} aria-hidden="true" />
                {copy.back}
              </button>
              {flow !== "full" && onCancel ? (
                <button className="secondaryButton setupBack" type="button" onClick={cancelSetup}>
                  {copy.cancelSetup}
                </button>
              ) : null}
            </div>
            <button className="primaryButton setupPrimary interviewNext" type="button" onClick={() => void continueInterview()}>
              {copy.next}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="privacyNote"><ShieldCheck size={15} aria-hidden="true" />{copy.privacy}</p>
      </div>
    </section>
  );
}
