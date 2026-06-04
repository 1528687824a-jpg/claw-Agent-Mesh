import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROUTING_MODES,
  type AgentClusterAgentConfig,
  type AgentClusterConfig,
  type RoutingMode,
  type StageDefinition
} from "../packages/shared/src/types";

type InterviewAnswers = {
  clusterId: string;
  name: string;
  primaryUseCase: string;
  audience?: string;
  tone?: string;
  desiredOutputs: string[];
  defaultRoutingMode?: RoutingMode;
  constraints?: string[];
};

type CliOptions = {
  answersPath: string;
  outDir: string;
  approve: boolean;
  planner?: PlannerMode;
  model?: string;
  baseUrl?: string;
};

type PlannerMode = "mock" | "openai-compatible";

type PlannerContext = {
  mode: PlannerMode;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  temperature: number;
  timeoutMs: number;
};

type PlannerStagePlan = {
  role: string;
  stageType?: string;
  name?: string;
  acceptanceCriteria?: string[];
  maxRetries?: number;
};

type PlannerResponse = {
  clusterId?: string;
  name?: string;
  description?: string;
  defaultRoutingMode?: RoutingMode;
  stages: PlannerStagePlan[];
};

const roleCatalog: Record<
  string,
  {
    id: string;
    role: string;
    displayName: string;
    stageType?: string;
    stageName?: string;
    capabilities: string[];
    acceptanceCriteria: string[];
  }
> = {
  research: {
    id: "research-agent",
    role: "research",
    displayName: "Research Agent",
    stageType: "research",
    stageName: "Collect task context",
    capabilities: ["source gathering", "fact extraction", "risk and constraint notes"],
    acceptanceCriteria: [
      "Collect relevant facts, assumptions, constraints, and risks.",
      "Summarize the context in a form downstream agents can reuse.",
      "Call out uncertainty instead of inventing facts."
    ]
  },
  writing: {
    id: "writer-agent",
    role: "writing",
    displayName: "Writer Agent",
    stageType: "write",
    stageName: "Write requested content",
    capabilities: ["copywriting", "article drafting", "summaries", "handoffs"],
    acceptanceCriteria: [
      "Use the user request and upstream context as input.",
      "Produce clear written content for the requested audience and tone.",
      "Include a handoff note when a later visual stage needs this text."
    ]
  },
  image: {
    id: "image-agent",
    role: "image",
    displayName: "Image Agent",
    stageType: "image",
    stageName: "Create image brief",
    capabilities: ["image briefs", "visual direction", "image prompt drafting"],
    acceptanceCriteria: [
      "Use upstream text and constraints as visual input.",
      "Produce an image brief or prompt suitable for a later media provider.",
      "Preserve subject, style, audience, and usage requirements."
    ]
  },
  video: {
    id: "video-agent",
    role: "video",
    displayName: "Video Agent",
    stageType: "video",
    stageName: "Create video brief",
    capabilities: ["storyboards", "motion prompts", "shot planning"],
    acceptanceCriteria: [
      "Use upstream text and constraints as video input.",
      "Produce a storyboard, shot list, or video prompt.",
      "Preserve subject, motion, timing, and style requirements."
    ]
  }
};

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    approve: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--answers") {
      options.answersPath = argv[++index];
    } else if (arg === "--out") {
      options.outDir = argv[++index];
    } else if (arg === "--approve") {
      options.approve = true;
    } else if (arg === "--planner") {
      options.planner = parsePlannerMode(argv[++index]);
    } else if (arg === "--model") {
      options.model = argv[++index];
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.answersPath) {
    throw new Error("Missing --answers <path>");
  }
  if (!options.outDir) {
    throw new Error("Missing --out <dir>");
  }

  return options as CliOptions;
}

function parsePlannerMode(value: unknown): PlannerMode {
  if (value === undefined || value === null || value === "") {
    return "mock";
  }
  if (value === "mock" || value === "openai-compatible") {
    return value;
  }
  throw new Error("Planner must be one of: mock, openai-compatible");
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseAnswers(raw: unknown): InterviewAnswers {
  const input = raw as Record<string, unknown>;
  const desiredOutputs = Array.isArray(input.desiredOutputs)
    ? input.desiredOutputs.map((item) => asString(item, "desiredOutputs[]"))
    : [];

  if (desiredOutputs.length === 0) {
    throw new Error("desiredOutputs must include at least one role");
  }

  const defaultRoutingMode =
    typeof input.defaultRoutingMode === "string" &&
    (ROUTING_MODES as readonly string[]).includes(input.defaultRoutingMode)
      ? (input.defaultRoutingMode as RoutingMode)
      : "supervisor_pipeline";

  return {
    clusterId: asString(input.clusterId, "clusterId"),
    name: asString(input.name, "name"),
    primaryUseCase: asString(input.primaryUseCase, "primaryUseCase"),
    audience: typeof input.audience === "string" ? input.audience.trim() : undefined,
    tone: typeof input.tone === "string" ? input.tone.trim() : undefined,
    desiredOutputs,
    defaultRoutingMode,
    constraints: Array.isArray(input.constraints)
      ? input.constraints.map((item) => asString(item, "constraints[]"))
      : []
  };
}

function uniqueRoles(outputs: string[]) {
  const roles = outputs.map((output) => output.toLowerCase().trim()).filter(Boolean);
  return Array.from(new Set(roles));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPlannerContext(options: CliOptions): PlannerContext {
  const mode = options.planner ?? parsePlannerMode(process.env.M3_PLANNER_MODE);
  const context: PlannerContext = {
    mode,
    baseUrl: optionalString(options.baseUrl) ?? optionalString(process.env.M3_PLANNER_BASE_URL),
    model: optionalString(options.model) ?? optionalString(process.env.M3_PLANNER_MODEL),
    apiKey: optionalString(process.env.M3_PLANNER_API_KEY),
    temperature: numberFromEnv(process.env.M3_PLANNER_TEMPERATURE, 0.2),
    timeoutMs: Math.max(1, numberFromEnv(process.env.M3_PLANNER_TIMEOUT_SECONDS, 60)) * 1000
  };

  if (context.mode === "openai-compatible") {
    if (!context.baseUrl) {
      throw new Error("M3_PLANNER_BASE_URL or --base-url is required for openai-compatible planner");
    }
    if (!context.model) {
      throw new Error("M3_PLANNER_MODEL or --model is required for openai-compatible planner");
    }
    if (!context.apiKey) {
      throw new Error("M3_PLANNER_API_KEY is required for openai-compatible planner");
    }
  }

  return context;
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof (part as Record<string, unknown>).text === "string") {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error("Planner response did not contain a JSON object");
  }
}

function asOptionalRoutingMode(value: unknown): RoutingMode | undefined {
  if (typeof value === "string" && (ROUTING_MODES as readonly string[]).includes(value)) {
    return value as RoutingMode;
  }
  return undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parsePlannerResponse(raw: unknown): PlannerResponse {
  const input = raw as Record<string, unknown>;
  const rawStages = Array.isArray(input.stages) ? input.stages : [];
  if (rawStages.length === 0) {
    throw new Error("Planner response must include at least one stage");
  }

  return {
    clusterId: optionalString(input.clusterId),
    name: optionalString(input.name),
    description: optionalString(input.description),
    defaultRoutingMode: asOptionalRoutingMode(input.defaultRoutingMode),
    stages: rawStages.map((stage, index) => {
      const item = stage as Record<string, unknown>;
      const role = optionalString(item.role)?.toLowerCase();
      if (!role) {
        throw new Error(`Planner response stages[${index}].role must be a non-empty string`);
      }
      if (!roleCatalog[role]) {
        throw new Error(`Planner response stages[${index}].role is unsupported: ${role}`);
      }
      const maxRetries = typeof item.maxRetries === "number" && Number.isInteger(item.maxRetries)
        ? item.maxRetries
        : undefined;
      return {
        role,
        stageType: optionalString(item.stageType),
        name: optionalString(item.name),
        acceptanceCriteria: asOptionalStringArray(item.acceptanceCriteria),
        maxRetries
      };
    })
  };
}

async function callOpenAiCompatiblePlanner(
  answers: InterviewAnswers,
  context: PlannerContext
): Promise<PlannerResponse> {
  if (!context.baseUrl || !context.model || !context.apiKey) {
    throw new Error("OpenAI-compatible planner context is incomplete");
  }

  const availableRoles = Object.values(roleCatalog).map((role) => ({
    role: role.role,
    id: role.id,
    stageType: role.stageType,
    defaultStageName: role.stageName,
    defaultAcceptanceCriteria: role.acceptanceCriteria
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs);
  try {
    const response = await fetch(chatCompletionsUrl(context.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${context.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: context.model,
        temperature: context.temperature,
        messages: [
          {
            role: "system",
            content: [
              "You plan honeycomb agent clusters from interview answers.",
              "Return only JSON, with no Markdown.",
              "Use only roles from the provided catalog.",
              "Prefer the smallest useful sequence of stages.",
              "Schema: { clusterId?, name?, description?, defaultRoutingMode?, stages: [{ role, stageType?, name?, acceptanceCriteria?, maxRetries? }] }."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                interviewAnswers: answers,
                allowedRoutingModes: ROUTING_MODES,
                availableRoles
              },
              null,
              2
            )
          }
        ]
      })
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`Planner HTTP request failed with ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const choices = payload.choices as Array<Record<string, unknown>> | undefined;
    const content = contentToText((choices?.[0]?.message as Record<string, unknown> | undefined)?.content);
    if (!content.trim()) {
      throw new Error("Planner response did not include choices[0].message.content");
    }
    return parsePlannerResponse(parseJsonObject(content));
  } finally {
    clearTimeout(timeout);
  }
}

function buildAgentPrompt(answers: InterviewAnswers, agent: AgentClusterAgentConfig) {
  return [
    `# ${agent.id}`,
    "",
    `Role: ${agent.role}`,
    `Cluster: ${answers.name}`,
    `Primary use case: ${answers.primaryUseCase}`,
    answers.audience ? `Audience: ${answers.audience}` : null,
    answers.tone ? `Tone: ${answers.tone}` : null,
    "",
    "Capabilities:",
    ...agent.capabilities.map((capability) => `- ${capability}`),
    "",
    "Operating rules:",
    "- Treat upstream artifacts as the source of truth.",
    "- Keep outputs structured enough for the orchestrator and test-agent to inspect.",
    "- Mark uncertainty clearly instead of inventing missing details.",
    ...(answers.constraints?.length
      ? ["", "Cluster constraints:", ...answers.constraints.map((constraint) => `- ${constraint}`)]
      : [])
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildAgents(childRoles: string[]): AgentClusterAgentConfig[] {
  const agents: AgentClusterAgentConfig[] = [
    {
      id: "main-agent",
      role: "orchestrator",
      displayName: "Main Agent",
      promptPath: "agents/main-agent/AGENTS.md",
      capabilities: ["planning", "routing", "final synthesis"]
    },
    ...childRoles.map((role) => {
      const catalogEntry = roleCatalog[role];
      if (!catalogEntry) {
        throw new Error(`Unsupported desired output role: ${role}`);
      }
      return {
        id: catalogEntry.id,
        role: catalogEntry.role,
        displayName: catalogEntry.displayName,
        promptPath: `agents/${catalogEntry.id}/AGENTS.md`,
        capabilities: catalogEntry.capabilities
      };
    }),
    {
      id: "test-agent",
      role: "quality",
      displayName: "Test Agent",
      promptPath: "agents/test-agent/AGENTS.md",
      capabilities: ["quality gate", "retry guidance", "acceptance checks"]
    }
  ];

  return agents;
}

function buildMockConfig(answers: InterviewAnswers, answersPath: string): AgentClusterConfig {
  const childRoles = uniqueRoles(answers.desiredOutputs);
  const agents = buildAgents(childRoles);

  const stages: StageDefinition[] = childRoles.map((role) => {
    const catalogEntry = roleCatalog[role];
    if (!catalogEntry?.stageType || !catalogEntry.stageName) {
      throw new Error(`Role cannot be used as a stage: ${role}`);
    }
    return {
      stageType: catalogEntry.stageType,
      agentId: catalogEntry.id,
      name: catalogEntry.stageName,
      acceptanceCriteria: catalogEntry.acceptanceCriteria,
      maxRetries: 3
    };
  });

  return {
    schemaVersion: "agent-openclaw.cluster.v1",
    clusterId: answers.clusterId,
    name: answers.name,
    description: answers.primaryUseCase,
    defaultRoutingMode: answers.defaultRoutingMode ?? "supervisor_pipeline",
    agents,
    stages,
    generatedAt: new Date().toISOString(),
    source: {
      planner: "mock",
      answersPath
    }
  };
}

function buildConfigFromPlannerResponse(
  answers: InterviewAnswers,
  answersPath: string,
  plan: PlannerResponse,
  context: PlannerContext
): AgentClusterConfig {
  const childRoles = uniqueRoles(plan.stages.map((stage) => stage.role));
  const agents = buildAgents(childRoles);

  const stages: StageDefinition[] = plan.stages.map((stage) => {
    const catalogEntry = roleCatalog[stage.role];
    if (!catalogEntry?.stageType || !catalogEntry.stageName) {
      throw new Error(`Planner selected a role that cannot be used as a stage: ${stage.role}`);
    }
    return {
      stageType: stage.stageType ?? catalogEntry.stageType,
      agentId: catalogEntry.id,
      name: stage.name ?? catalogEntry.stageName,
      acceptanceCriteria: stage.acceptanceCriteria ?? catalogEntry.acceptanceCriteria,
      maxRetries: stage.maxRetries ?? 3
    };
  });

  return {
    schemaVersion: "agent-openclaw.cluster.v1",
    clusterId: plan.clusterId ?? answers.clusterId,
    name: plan.name ?? answers.name,
    description: plan.description ?? answers.primaryUseCase,
    defaultRoutingMode: plan.defaultRoutingMode ?? answers.defaultRoutingMode ?? "supervisor_pipeline",
    agents,
    stages,
    generatedAt: new Date().toISOString(),
    source: {
      planner: context.mode,
      answersPath,
      model: context.model
    }
  };
}

async function buildConfig(
  answers: InterviewAnswers,
  answersPath: string,
  context: PlannerContext
): Promise<AgentClusterConfig> {
  if (context.mode === "mock") {
    return buildMockConfig(answers, answersPath);
  }

  const plan = await callOpenAiCompatiblePlanner(answers, context);
  return buildConfigFromPlannerResponse(answers, answersPath, plan, context);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const answersPath = path.resolve(options.answersPath);
  const outDir = path.resolve(options.outDir);
  const answers = parseAnswers(JSON.parse(await readFile(answersPath, "utf8")));
  const planner = getPlannerContext(options);
  const config = await buildConfig(answers, answersPath, planner);

  const preview = [
    `Cluster: ${config.name} (${config.clusterId})`,
    `Planner: ${config.source.planner}${config.source.model ? ` (${config.source.model})` : ""}`,
    `Routing mode: ${config.defaultRoutingMode}`,
    `Agents: ${config.agents.map((agent) => agent.id).join(", ")}`,
    `Stages: ${config.stages.map((stage) => `${stage.stageType}:${stage.agentId}`).join(" -> ")}`
  ].join("\n");

  if (!options.approve) {
    console.log(preview);
    console.log("");
    console.log("Preview only. Re-run with --approve to write cluster.config.json and AGENTS.md files.");
    return;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "cluster.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "preview.md"), `${preview}\n`, "utf8");

  for (const agent of config.agents) {
    const agentDir = path.join(outDir, "agents", agent.id);
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "AGENTS.md"), `${buildAgentPrompt(answers, agent)}\n`, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        clusterId: config.clusterId,
        configPath: path.join(outDir, "cluster.config.json"),
        stageCount: config.stages.length,
        agentCount: config.agents.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
