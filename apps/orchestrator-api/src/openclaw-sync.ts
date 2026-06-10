import { promises as fs } from "node:fs";
import path from "node:path";
import {
  listAgentConfigs,
  listModelProviders
} from "../../../packages/db/src/config-registry";
import type { AgentConfigRecord, ModelProviderRecord } from "../../../packages/shared/src/types";
import { discoverOpenClawRuntime } from "./openclaw-runtime";

export type OpenClawAgentSyncItem = {
  honeycombAgentId: string;
  openclawAgentId: string;
  displayName: string;
  role: string;
  enabled: boolean;
  model: string | null;
  providerId: string | null;
  apiKeyConfigured: boolean;
  sourceTemplatePath: string;
  sourceTemplateExists: boolean;
  targetAgentPromptPath: string;
  targetWorkspacePromptPath: string;
  status: "ready" | "missing_template";
};

export type OpenClawSyncPlan = {
  generatedAt: string;
  rootPath: string;
  configPath: string;
  agents: OpenClawAgentSyncItem[];
  providers: Array<{
    id: string;
    displayName: string;
    baseUrl: string;
    defaultModel: string | null;
    apiKeyConfigured: boolean;
    apiKeyFingerprint: string | null;
    verificationStatus: string;
  }>;
  warnings: string[];
};

export type OpenClawSyncApplyResult = {
  appliedAt: string;
  plan: OpenClawSyncPlan;
  writtenFiles: string[];
  skippedFiles: string[];
};

export type OpenClawValidationResult = {
  checkedAt: string;
  rootPath: string;
  requiredAgents: Array<{
    honeycombAgentId: string;
    openclawAgentId: string;
    present: boolean;
    agentPromptPath: string;
    workspacePromptPath: string;
  }>;
  missingAgentIds: string[];
  ok: boolean;
};

function templateRoot() {
  return path.resolve("platform-assets", "openclaw-agent-templates", "agents");
}

function openClawAgentId(agent: AgentConfigRecord) {
  const value = agent.metadata.openclawAgentId;
  return typeof value === "string" && value.trim() ? value.trim() : agent.id;
}

async function exists(filePath: string) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRootPath(rootPath?: string) {
  if (rootPath) {
    return path.resolve(rootPath);
  }
  const discovery = await discoverOpenClawRuntime();
  return discovery.selected?.rootPath ? path.resolve(discovery.selected.rootPath) : null;
}

function redactedProvider(provider: ModelProviderRecord) {
  return {
    id: provider.id,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    apiKeyConfigured: provider.apiKeyConfigured,
    apiKeyFingerprint: provider.apiKeyFingerprint,
    verificationStatus: provider.verificationStatus
  };
}

export async function buildOpenClawSyncPlan(input: {
  rootPath?: string;
} = {}): Promise<OpenClawSyncPlan | null> {
  const rootPath = await resolveRootPath(input.rootPath);
  if (!rootPath) {
    return null;
  }

  const [agents, providers] = await Promise.all([listAgentConfigs(), listModelProviders()]);
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const warnings: string[] = [];
  if (enabledAgents.length === 0) {
    warnings.push("no_enabled_agents");
  }

  const agentItems = await Promise.all(
    enabledAgents.map(async (agent): Promise<OpenClawAgentSyncItem> => {
      const externalId = openClawAgentId(agent);
      const sourceTemplatePath =
        agent.promptTemplatePath || path.join(templateRoot(), `${externalId}.md`);
      const sourceTemplateExists = await exists(sourceTemplatePath);
      if (!sourceTemplateExists) {
        warnings.push(`missing_template:${externalId}`);
      }

      return {
        honeycombAgentId: agent.id,
        openclawAgentId: externalId,
        displayName: agent.displayName,
        role: agent.agentRole,
        enabled: agent.enabled,
        model: agent.model,
        providerId: agent.providerId,
        apiKeyConfigured: agent.apiKeyConfigured,
        sourceTemplatePath,
        sourceTemplateExists,
        targetAgentPromptPath: path.join(rootPath, "agents", externalId, "agent", "AGENTS.md"),
        targetWorkspacePromptPath: path.join(rootPath, "workspace", externalId, "AGENTS.md"),
        status: sourceTemplateExists ? "ready" : "missing_template"
      };
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    rootPath,
    configPath: path.join(rootPath, "config", "honeycomb.generated.json"),
    agents: agentItems,
    providers: providers.map(redactedProvider),
    warnings
  };
}

function fallbackPrompt(agent: OpenClawAgentSyncItem) {
  return [
    `# ${agent.displayName}`,
    "",
    `Honeycomb role: ${agent.role}`,
    `OpenClaw agent id: ${agent.openclawAgentId}`,
    "",
    "This prompt was generated because the expected Honeycomb template was missing.",
    "Review and replace it before production use.",
    ""
  ].join("\n");
}

async function readPromptTemplate(agent: OpenClawAgentSyncItem) {
  if (!agent.sourceTemplateExists) {
    return fallbackPrompt(agent);
  }
  return fs.readFile(agent.sourceTemplatePath, "utf8");
}

export async function applyOpenClawSyncPlan(input: {
  rootPath?: string;
} = {}): Promise<OpenClawSyncApplyResult | null> {
  const plan = await buildOpenClawSyncPlan(input);
  if (!plan) {
    return null;
  }

  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  await fs.mkdir(plan.rootPath, { recursive: true });

  for (const agent of plan.agents) {
    const prompt = await readPromptTemplate(agent);
    for (const targetPath of [agent.targetAgentPromptPath, agent.targetWorkspacePromptPath]) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, prompt, "utf8");
      writtenFiles.push(targetPath);
    }
  }

  await fs.mkdir(path.dirname(plan.configPath), { recursive: true });
  await fs.writeFile(
    plan.configPath,
    `${JSON.stringify(
      {
        generatedBy: "honeycomb",
        generatedAt: new Date().toISOString(),
        agents: plan.agents.map((agent) => ({
          honeycombAgentId: agent.honeycombAgentId,
          openclawAgentId: agent.openclawAgentId,
          displayName: agent.displayName,
          role: agent.role,
          model: agent.model,
          providerId: agent.providerId,
          apiKeyConfigured: agent.apiKeyConfigured,
          enabled: agent.enabled
        })),
        providers: plan.providers
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writtenFiles.push(plan.configPath);

  return {
    appliedAt: new Date().toISOString(),
    plan,
    writtenFiles,
    skippedFiles
  };
}

export async function validateOpenClawSync(input: {
  rootPath?: string;
} = {}): Promise<OpenClawValidationResult | null> {
  const plan = await buildOpenClawSyncPlan(input);
  if (!plan) {
    return null;
  }

  const requiredAgents = await Promise.all(
    plan.agents.map(async (agent) => {
      const agentPromptExists = await exists(agent.targetAgentPromptPath);
      const workspacePromptExists = await exists(agent.targetWorkspacePromptPath);
      return {
        honeycombAgentId: agent.honeycombAgentId,
        openclawAgentId: agent.openclawAgentId,
        present: agentPromptExists || workspacePromptExists,
        agentPromptPath: agent.targetAgentPromptPath,
        workspacePromptPath: agent.targetWorkspacePromptPath
      };
    })
  );
  const missingAgentIds = requiredAgents
    .filter((agent) => !agent.present)
    .map((agent) => agent.openclawAgentId);

  return {
    checkedAt: new Date().toISOString(),
    rootPath: plan.rootPath,
    requiredAgents,
    missingAgentIds,
    ok: missingAgentIds.length === 0
  };
}
