import { useMemo, useState } from "react";
import type { RoutingMode } from "./api";

type Language = "en" | "zh";

type ProviderDraft = {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type InterviewDraft = {
  role: string;
  industry: string;
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

type FirstRunPanelProps = {
  language: Language;
};

const firstRunCopy = {
  en: {
    heading: "First Run",
    intro:
      "Set up the web workflow: learn the console, configure a provider, answer the interview, then generate personalized OpenClaw agent prompts.",
    stepGuide: "1. Get Oriented",
    stepProvider: "2. Provider Key",
    stepInterview: "3. Work Interview",
    stepGenerate: "4. Agent Prompts",
    guideTitle: "What this web panel controls",
    guideBody:
      "The console starts jobs, switches routing modes, inspects messages and timelines, and cancels runs. First-run setup teaches the platform what kind of work you do before it specializes agents.",
    providerTitle: "Configure a real planner provider",
    providerNote:
      "The key stays in memory in this preview. Generated setup files only record that a key was configured; they do not save the secret.",
    providerName: "Provider",
    baseUrl: "Base URL",
    model: "Model",
    apiKey: "API key",
    interviewTitle: "Tell Agent OpenClaw about your work",
    role: "Your role",
    industry: "Domain / industry",
    dailyWork: "Typical work",
    outputs: "Outputs you create",
    audience: "Audience",
    qualityBar: "Quality bar",
    constraints: "Constraints",
    generateTitle: "Generated work profile and agent prompts",
    save: "Save setup preview",
    saved: "Saved",
    browserFallback:
      "The web panel saved this setup preview to localStorage. A later backup-and-write step will apply it to real OpenClaw agent folders.",
    copyPath: "Output",
    providerMissing: "Add provider, model, and key before saving.",
    profile: "Detected profile",
    routing: "Recommended routing",
    stages: "Agent sequence",
    reviewTitle: "Review before writing",
    reviewItems: [
      "Does the work profile describe your real role and daily work?",
      "Does the routing mode fit how you expect the agent team to work?",
      "Do the agent responsibilities, boundaries, and tone feel right?",
      "Are any prompts too vague, too aggressive, or missing a workflow?",
      "Treat this as a draft until you explicitly choose a backup-and-write step."
    ],
    promptPreview: "Prompt preview",
    openclawBoundary:
      "This saves a safe setup preview first. Applying to real OpenClaw agent folders is a later explicit step with backups.",
    fields: {
      role: "Independent content/product builder",
      industry: "AI tools and creator products",
      dailyWork: "Research product ideas, write launch content, plan visuals, and test whether outputs are publishable.",
      outputs: "Research notes, articles, launch copy, image briefs",
      audience: "Builders, users, and early adopters",
      qualityBar: "Clear, practical, polished, and not over-hyped",
      constraints: "Keep outputs concise, cite uncertainty, avoid private deployment assumptions"
    }
  },
  zh: {
    heading: "首次启动",
    intro:
      "在网页操作面板里完成产品初始化：熟悉控制台、配置 provider、回答工作问题，然后生成适合你职业和任务的 OpenClaw agent 提示词。",
    stepGuide: "1. 熟悉界面",
    stepProvider: "2. 配置 Key",
    stepInterview: "3. 工作访谈",
    stepGenerate: "4. 生成 Agent",
    guideTitle: "这个网页操作面板控制什么",
    guideBody:
      "控制台负责启动任务、切换编排模式、查看消息和时间线、取消运行。首次启动会先理解你的工作类型，再把预设 agent 提示词个性化。",
    providerTitle: "配置真实 planner provider",
    providerNote:
      "当前预览版不会把 key 写入生成文件，只记录 key 已配置。key 暂时只保留在本次页面状态里。",
    providerName: "Provider",
    baseUrl: "Base URL",
    model: "模型",
    apiKey: "API key",
    interviewTitle: "告诉 Agent OpenClaw 你的工作方式",
    role: "你的职业/角色",
    industry: "领域/行业",
    dailyWork: "平常工作",
    outputs: "常见产出",
    audience: "面向对象",
    qualityBar: "质量标准",
    constraints: "约束",
    generateTitle: "生成的职业画像和 Agent 提示词",
    save: "保存配置预览",
    saved: "已保存",
    browserFallback:
      "网页面板已把预览保存到 localStorage。真正写入 OpenClaw agent 目录会在后续备份确认步骤里完成。",
    copyPath: "输出位置",
    providerMissing: "保存前需要填写 provider、模型和 key。",
    profile: "识别出的工作画像",
    routing: "推荐编排模式",
    stages: "Agent 顺序",
    reviewTitle: "写入前先检查",
    reviewItems: [
      "工作画像是否准确描述你的真实职业和日常工作？",
      "推荐编排模式是否符合你期待的 agent 协作方式？",
      "每个 agent 的职责、边界和语气是否合适？",
      "有没有提示词太空、太激进，或漏掉关键工作流？",
      "在你明确选择备份并写入之前，这里只是一版草稿。"
    ],
    promptPreview: "提示词预览",
    openclawBoundary:
      "当前先保存安全的 setup 预览。真正覆盖 OpenClaw agent 目录是后续显式步骤，并且必须带备份。",
    fields: {
      role: "独立内容/产品创作者",
      industry: "AI 工具与创作者产品",
      dailyWork: "研究产品想法、撰写发布内容、规划视觉，并测试产出是否可发布。",
      outputs: "研究笔记、文章、发布文案、图片 brief",
      audience: "开发者、用户和早期采用者",
      qualityBar: "清晰、实用、精致，不过度营销",
      constraints: "输出保持简洁，标注不确定性，避免假设私有部署事实"
    }
  }
};

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

function inferProfile(interview: InterviewDraft): Profile {
  const combined = `${interview.role} ${interview.industry} ${interview.dailyWork} ${interview.outputs}`.toLowerCase();
  const outputs = splitList(interview.outputs);
  const stageAgents = ["research-agent", "writer-agent"];
  if (/image|visual|poster|cover|图片|视觉|海报|封面/.test(combined)) stageAgents.push("image-agent");
  if (/video|short|reel|clip|视频|短视频|分镜/.test(combined)) stageAgents.push("video-agent");

  const recommendedRoutingMode: RoutingMode =
    /review|quality|test|approval|合规|审核|测试|质量/.test(combined)
      ? "supervisor_pipeline"
      : outputs.length >= 4
        ? "master_slave_discussion"
        : "supervisor_pipeline";

  return {
    title: `${interview.role || "Owner"} / ${interview.industry || "General work"}`,
    workPattern: interview.dailyWork || "General multi-agent work",
    recommendedRoutingMode,
    stageAgents,
    summary: [
      `Role: ${interview.role || "unknown"}`,
      `Domain: ${interview.industry || "unknown"}`,
      `Work: ${interview.dailyWork || "not specified"}`,
      `Outputs: ${outputs.join(", ") || "not specified"}`
    ].join("\n")
  };
}

function buildAgentPrompt(agentId: string, interview: InterviewDraft, profile: Profile) {
  const roleLines: Record<string, string> = {
    "main-agent": "You are the orchestration lead. Turn the user's real work into staged plans and final reports.",
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
    "Audience:",
    interview.audience || "Not specified",
    "",
    "Quality bar:",
    interview.qualityBar || "Clear, useful, and ready for review.",
    "",
    "Constraints:",
    interview.constraints || "Call out uncertainty and avoid inventing facts.",
    "",
    "Operating rules:",
    "- Stay inside this user's domain and work style.",
    "- Reuse upstream artifacts instead of restarting from scratch.",
    "- Keep handoffs structured so the next agent and test-agent can inspect them.",
    "- If the task needs information you do not have, mark the uncertainty clearly."
  ].join("\n");
}

function buildAgents(interview: InterviewDraft, profile: Profile): GeneratedAgent[] {
  const orderedIds = ["main-agent", ...profile.stageAgents, "test-agent"];
  return orderedIds.map((id) => ({
    id,
    displayName: id.replace(/-/g, " "),
    role: id.replace("-agent", ""),
    prompt: buildAgentPrompt(id, interview, profile)
  }));
}

async function saveDesktopSetup(payload: unknown) {
  const serialized = JSON.stringify(payload);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("save_first_run_setup", { payload: serialized });
  } catch {
    window.localStorage.setItem("agentOpenClaw.firstRunPreview", serialized);
    return "";
  }
}

export function FirstRunPanel({ language }: FirstRunPanelProps) {
  const copy = firstRunCopy[language];
  const [provider, setProvider] = useState<ProviderDraft>({
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: ""
  });
  const [interview, setInterview] = useState<InterviewDraft>(copy.fields);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");

  const profile = useMemo(() => inferProfile(interview), [interview]);
  const agents = useMemo(() => buildAgents(interview, profile), [interview, profile]);

  function updateProvider(field: keyof ProviderDraft, value: string) {
    setProvider((current) => ({ ...current, [field]: value }));
  }

  function updateInterview(field: keyof InterviewDraft, value: string) {
    setInterview((current) => ({ ...current, [field]: value }));
  }

  async function saveSetup() {
    setError("");
    setSaveStatus("");
    if (!provider.providerName.trim() || !provider.model.trim() || !provider.apiKey.trim()) {
      setError(copy.providerMissing);
      return;
    }

    const clusterConfig = {
      schemaVersion: "agent-openclaw.cluster.v1",
      clusterId: slug(`${interview.role}-${interview.industry}`),
      name: `${interview.role || "Owner"} Agent Cluster`,
      description: interview.dailyWork,
      defaultRoutingMode: profile.recommendedRoutingMode,
      agents: agents.map((agent) => ({
        id: agent.id,
        role: agent.role,
        displayName: agent.displayName,
        promptPath: `agents/${agent.id}/AGENTS.md`,
        capabilities: agent.id === "main-agent" ? ["planning", "routing", "final synthesis"] : ["specialized work"]
      })),
      stages: profile.stageAgents.map((agentId) => ({
        stageType: agentId.replace("-agent", ""),
        agentId,
        name: agentId.replace(/-/g, " "),
        acceptanceCriteria: ["Use the user's work profile and quality bar."],
        maxRetries: 3
      })),
      generatedAt: new Date().toISOString(),
      source: {
        planner: "desktop-first-run",
        model: provider.model
      }
    };

    const output = await saveDesktopSetup({
      provider: {
        providerName: provider.providerName,
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiKeyConfigured: true
      },
      interview,
      profile,
      clusterConfig,
      agents: agents.map((agent) => ({
        path: `agents/${agent.id}/AGENTS.md`,
        contents: agent.prompt
      }))
    });

    setSaveStatus(output ? `${copy.saved}: ${output}` : copy.browserFallback);
  }

  return (
    <section className="firstRun">
      <div className="firstRunHero">
        <div>
          <h2>{copy.heading}</h2>
          <p>{copy.intro}</p>
        </div>
        <div className="stepRail" aria-label="First run steps">
          <span>{copy.stepGuide}</span>
          <span>{copy.stepProvider}</span>
          <span>{copy.stepInterview}</span>
          <span>{copy.stepGenerate}</span>
        </div>
      </div>

      <div className="firstRunGrid">
        <section className="setupPanel">
          <h3>{copy.guideTitle}</h3>
          <p>{copy.guideBody}</p>
          <p className="boundaryNote">{copy.openclawBoundary}</p>
        </section>

        <section className="setupPanel">
          <h3>{copy.providerTitle}</h3>
          <p>{copy.providerNote}</p>
          <div className="fieldGrid">
            <label>
              {copy.providerName}
              <input value={provider.providerName} onChange={(event) => updateProvider("providerName", event.target.value)} />
            </label>
            <label>
              {copy.baseUrl}
              <input value={provider.baseUrl} onChange={(event) => updateProvider("baseUrl", event.target.value)} />
            </label>
            <label>
              {copy.model}
              <input value={provider.model} onChange={(event) => updateProvider("model", event.target.value)} />
            </label>
            <label>
              {copy.apiKey}
              <input
                type="password"
                value={provider.apiKey}
                onChange={(event) => updateProvider("apiKey", event.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        </section>

        <section className="setupPanel interviewPanel">
          <h3>{copy.interviewTitle}</h3>
          <div className="fieldGrid">
            <label>
              {copy.role}
              <input value={interview.role} onChange={(event) => updateInterview("role", event.target.value)} />
            </label>
            <label>
              {copy.industry}
              <input value={interview.industry} onChange={(event) => updateInterview("industry", event.target.value)} />
            </label>
            <label>
              {copy.dailyWork}
              <textarea value={interview.dailyWork} onChange={(event) => updateInterview("dailyWork", event.target.value)} />
            </label>
            <label>
              {copy.outputs}
              <textarea value={interview.outputs} onChange={(event) => updateInterview("outputs", event.target.value)} />
            </label>
            <label>
              {copy.audience}
              <input value={interview.audience} onChange={(event) => updateInterview("audience", event.target.value)} />
            </label>
            <label>
              {copy.qualityBar}
              <textarea value={interview.qualityBar} onChange={(event) => updateInterview("qualityBar", event.target.value)} />
            </label>
            <label>
              {copy.constraints}
              <textarea value={interview.constraints} onChange={(event) => updateInterview("constraints", event.target.value)} />
            </label>
          </div>
        </section>

        <section className="setupPanel generatedPanel">
          <div className="generatedHeader">
            <h3>{copy.generateTitle}</h3>
            <button type="button" onClick={saveSetup}>
              {copy.save}
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
          {saveStatus ? <p className="successMessage">{saveStatus}</p> : null}
          <dl className="profileSummary">
            <div>
              <dt>{copy.profile}</dt>
              <dd>{profile.title}</dd>
            </div>
            <div>
              <dt>{copy.routing}</dt>
              <dd>{profile.recommendedRoutingMode}</dd>
            </div>
            <div>
              <dt>{copy.stages}</dt>
              <dd>{profile.stageAgents.join(" -> ")}</dd>
            </div>
          </dl>
          <div className="reviewChecklist">
            <h4>{copy.reviewTitle}</h4>
            <ul>
              {copy.reviewItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="promptPreviewGrid">
            {agents.map((agent) => (
              <article className="promptPreview" key={agent.id}>
                <h4>{agent.id}</h4>
                <pre>{agent.prompt}</pre>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
