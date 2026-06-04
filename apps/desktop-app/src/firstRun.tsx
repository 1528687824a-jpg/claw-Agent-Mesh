import { useMemo, useState } from "react";
import { ArrowRight, Check, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import type { RoutingMode } from "./api";
import { HoneycombLogo } from "./brand";

type Language = "en" | "zh";
type SetupStage = "provider" | "providerLeaving" | "interview" | "thinking" | "review" | "saving";

type ProviderDraft = {
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
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

type FirstRunPanelProps = {
  language: Language;
  onComplete: () => void;
};

const copyByLanguage = {
  en: {
    heading: "First Run",
    providerEyebrow: "Private provider setup",
    providerTitle: "Connect the AI that powers your panel",
    providerIntro:
      "Honeycomb uses this provider to understand your work and specialize your agent team. Your key is kept out of generated prompt files.",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "Model",
    apiKey: "API key",
    connect: "Connect and continue",
    providerMissing: "Add the provider, model, and API key to continue.",
    interviewEyebrow: "Work interview",
    interviewTitle: "Tell Honeycomb how you work",
    interviewReason:
      "Your answers let the panel choose a practical routing mode and rewrite each agent prompt around your real work.",
    privacy: "These answers are used only to configure this local panel. They are never uploaded or disclosed.",
    thinking: "Agent is thinking",
    next: "Next",
    reviewTitle: "Your agent team is ready",
    reviewIntro: "Review the profile Honeycomb inferred, then write the first local setup bundle.",
    profile: "Detected profile",
    routing: "Recommended routing",
    stages: "Agent sequence",
    write: "Create my agent team",
    saving: "Writing local setup",
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
      "main-agent": "Coordinates planning, routing, and synthesis",
      "research-agent": "Finds context, evidence, constraints, and risks",
      "writer-agent": "Turns upstream work into polished deliverables",
      "image-agent": "Builds visual briefs and image prompts",
      "video-agent": "Builds storyboards and video plans",
      "test-agent": "Checks work against your quality bar"
    }
  },
  zh: {
    heading: "首次启动",
    providerEyebrow: "私密 Provider 配置",
    providerTitle: "连接驱动面板的 AI",
    providerIntro:
      "Honeycomb 会用这个 Provider 理解你的工作，并为你的 Agent 团队定制提示词。API Key 不会写入生成的提示词文件。",
    provider: "Provider",
    baseUrl: "Base URL",
    model: "模型",
    apiKey: "API Key",
    connect: "连接并继续",
    providerMissing: "请填写 Provider、模型和 API Key 后继续。",
    interviewEyebrow: "工作访谈",
    interviewTitle: "告诉 Honeycomb 你的工作方式",
    interviewReason:
      "这些回答会帮助面板选择合适的编排方式，并围绕你的真实工作改写每个 Agent 的提示词。",
    privacy: "问题仅供本地面板配置参考，绝不上传、泄露或用于其他用途。",
    thinking: "Agent 正在思考中",
    next: "下一步",
    reviewTitle: "你的 Agent 团队已经准备好",
    reviewIntro: "确认 Honeycomb 理解的工作画像，然后写入第一份本地配置。",
    profile: "识别出的工作画像",
    routing: "推荐编排模式",
    stages: "Agent 顺序",
    write: "创建我的 Agent 团队",
    saving: "正在写入本地配置",
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
      "main-agent": "负责规划、编排和最终整合",
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
  return language === "zh" ? `例如：${industry}从业者、负责人、独立创作者……` : `For example: ${industry} specialist, lead, independent creator...`;
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
  return language === "zh"
    ? ["研究与信息整理", "方案设计与执行", "质量检查与修改", "沟通、交付与复盘"]
    : ["Research and synthesis", "Planning and execution", "Quality review and revision", "Communication, delivery, and reflection"];
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
    "Operating rules:",
    "- Stay inside this user's domain and work style.",
    "- Reuse upstream artifacts instead of restarting from scratch.",
    "- Keep handoffs structured so the next agent can inspect them.",
    "- Mark uncertainty clearly instead of inventing facts.",
    `- Optimize for this quality bar: ${interview.qualityBar || "clear, useful, and ready for review"}.`
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
    window.localStorage.setItem("honeycomb.firstRunPreview", serialized);
    return "";
  }
}

export function FirstRunPanel({ language, onComplete }: FirstRunPanelProps) {
  const copy = copyByLanguage[language];
  const [stage, setStage] = useState<SetupStage>("provider");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [provider, setProvider] = useState<ProviderDraft>({
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: ""
  });
  const [interview, setInterview] = useState<InterviewDraft>({
    industry: "",
    role: "",
    dailyWork: "",
    outputs: "",
    audience: "",
    qualityBar: "",
    constraints: ""
  });
  const [otherWork, setOtherWork] = useState("");
  const [error, setError] = useState("");

  const rolePlaceholder = useMemo(() => buildRolePlaceholder(interview.industry, language), [interview.industry, language]);
  const workOptions = useMemo(() => buildWorkOptions(interview.industry, interview.role, language), [interview.industry, interview.role, language]);
  const profile = useMemo(() => inferProfile(interview), [interview]);
  const agents = useMemo(() => buildAgents(interview, profile), [interview, profile]);

  function updateProvider(field: keyof ProviderDraft, value: string) {
    setProvider((current) => ({ ...current, [field]: value }));
  }

  function updateInterview(field: keyof InterviewDraft, value: string) {
    setInterview((current) => ({ ...current, [field]: value }));
  }

  function connectProvider() {
    if (!provider.providerName.trim() || !provider.model.trim() || !provider.apiKey.trim()) {
      setError(copy.providerMissing);
      return;
    }
    setError("");
    setStage("providerLeaving");
    window.setTimeout(() => setStage("interview"), 560);
  }

  function thinkThen(nextQuestion: number) {
    setStage("thinking");
    window.setTimeout(() => {
      setQuestionIndex(nextQuestion);
      setStage("interview");
    }, 950);
  }

  function continueInterview() {
    setError("");
    if (questionIndex === 0) {
      if (!interview.industry.trim()) return;
      thinkThen(1);
      return;
    }
    if (questionIndex === 1) {
      if (!interview.role.trim()) return;
      thinkThen(2);
      return;
    }
    if (questionIndex === 2) {
      const work = [interview.dailyWork, otherWork].filter(Boolean).join("；");
      if (!work.trim()) return;
      updateInterview("dailyWork", work);
      setQuestionIndex(3);
      return;
    }
    if (!interview.qualityBar.trim()) return;
    setStage("review");
  }

  function toggleWorkOption(option: string) {
    const selected = splitList(interview.dailyWork);
    const next = selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option];
    updateInterview("dailyWork", next.join("，"));
  }

  async function saveSetup() {
    setStage("saving");
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
      source: { planner: "desktop-first-run", model: provider.model }
    };

    await saveDesktopSetup({
      provider: {
        providerName: provider.providerName,
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiKeyConfigured: true
      },
      interview,
      profile,
      clusterConfig,
      agents: agents.map((agent) => ({ path: `agents/${agent.id}/AGENTS.md`, contents: agent.prompt }))
    });
    window.localStorage.setItem("honeycomb.setupCompleted", "true");
    window.setTimeout(onComplete, 520);
  }

  if (stage === "provider" || stage === "providerLeaving") {
    return (
      <section className="firstRun focusSetup">
        <div className={`setupFocusCard providerFocus ${stage === "providerLeaving" ? "leaving" : ""}`}>
          <div className="setupLogoWrap">
            <HoneycombLogo size={72} mode="talking" />
          </div>
          <p className="eyebrow">{copy.providerEyebrow}</p>
          <h1>{copy.providerTitle}</h1>
          <p className="setupLead">{copy.providerIntro}</p>
          <div className="providerFields">
            <label>
              {copy.provider}
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
              <input type="password" value={provider.apiKey} onChange={(event) => updateProvider("apiKey", event.target.value)} autoComplete="off" />
            </label>
          </div>
          {error ? <p className="error">{error}</p> : null}
          <button className="primaryButton setupPrimary" type="button" onClick={connectProvider}>
            <KeyRound size={16} aria-hidden="true" />
            {copy.connect}
          </button>
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

  if (stage === "review" || stage === "saving") {
    return (
      <section className="firstRun focusSetup">
        <div className={`reviewStage ${stage === "saving" ? "saving" : ""}`}>
          <div className="reviewHeading">
            <HoneycombLogo size={58} mode={stage === "saving" ? "thinking" : "idle"} />
            <div>
              <p className="eyebrow">{copy.providerReady}</p>
              <h1>{stage === "saving" ? copy.saving : copy.reviewTitle}</h1>
              <p>{copy.reviewIntro}</p>
            </div>
          </div>
          <dl className="profileSummary">
            <div><dt>{copy.profile}</dt><dd>{profile.title}</dd></div>
            <div><dt>{copy.routing}</dt><dd>{profile.recommendedRoutingMode}</dd></div>
            <div><dt>{copy.stages}</dt><dd>{profile.stageAgents.join(" → ")}</dd></div>
          </dl>
          <div className="agentReviewGrid">
            {agents.map((agent) => (
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
              <textarea autoFocus value={interview.qualityBar} placeholder={copy.q4Placeholder} onChange={(event) => updateInterview("qualityBar", event.target.value)} />
            </label>
          ) : null}
          <button className="primaryButton setupPrimary" type="button" onClick={continueInterview}>
            {copy.next}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="privacyNote"><ShieldCheck size={15} aria-hidden="true" />{copy.privacy}</p>
      </div>
    </section>
  );
}
