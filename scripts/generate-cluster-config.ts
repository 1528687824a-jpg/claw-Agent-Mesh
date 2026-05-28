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

function buildConfig(answers: InterviewAnswers, answersPath: string): AgentClusterConfig {
  const childRoles = uniqueRoles(answers.desiredOutputs);
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const answersPath = path.resolve(options.answersPath);
  const outDir = path.resolve(options.outDir);
  const answers = parseAnswers(JSON.parse(await readFile(answersPath, "utf8")));
  const config = buildConfig(answers, answersPath);

  const preview = [
    `Cluster: ${config.name} (${config.clusterId})`,
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
