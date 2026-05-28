import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ROUTING_MODES,
  type AgentClusterConfig,
  type RoutingMode,
  type StageDefinition
} from "../../../../packages/shared/src/types";

export type LoadedClusterConfig = AgentClusterConfig & {
  configPath: string;
};

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid cluster config: ${field} must be a non-empty string`);
  }
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Invalid cluster config: ${field} must be a string array`);
  }
  return value;
}

function asRoutingMode(value: unknown): RoutingMode {
  if (typeof value === "string" && (ROUTING_MODES as readonly string[]).includes(value)) {
    return value as RoutingMode;
  }
  throw new Error(`Invalid cluster config: defaultRoutingMode must be one of ${ROUTING_MODES.join(", ")}`);
}

function asStages(value: unknown): StageDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Invalid cluster config: stages must be a non-empty array");
  }

  return value.map((stage, index) => {
    const input = stage as Record<string, unknown>;
    return {
      stageType: asString(input.stageType, `stages[${index}].stageType`),
      agentId: asString(input.agentId, `stages[${index}].agentId`),
      name: asString(input.name, `stages[${index}].name`),
      acceptanceCriteria: asStringArray(input.acceptanceCriteria, `stages[${index}].acceptanceCriteria`),
      maxRetries:
        typeof input.maxRetries === "number" && Number.isInteger(input.maxRetries)
          ? input.maxRetries
          : undefined
    };
  });
}

function parseClusterConfig(raw: unknown, configPath: string): LoadedClusterConfig {
  const input = raw as Record<string, unknown>;
  if (input.schemaVersion !== "agent-openclaw.cluster.v1") {
    throw new Error("Invalid cluster config: schemaVersion must be agent-openclaw.cluster.v1");
  }

  const agents = Array.isArray(input.agents)
    ? input.agents.map((agent, index) => {
        const item = agent as Record<string, unknown>;
        return {
          id: asString(item.id, `agents[${index}].id`),
          role: asString(item.role, `agents[${index}].role`),
          displayName: asString(item.displayName, `agents[${index}].displayName`),
          promptPath: asString(item.promptPath, `agents[${index}].promptPath`),
          capabilities: asStringArray(item.capabilities, `agents[${index}].capabilities`)
        };
      })
    : [];

  if (agents.length === 0) {
    throw new Error("Invalid cluster config: agents must be a non-empty array");
  }

  return {
    schemaVersion: "agent-openclaw.cluster.v1",
    clusterId: asString(input.clusterId, "clusterId"),
    name: asString(input.name, "name"),
    description: asString(input.description, "description"),
    defaultRoutingMode: asRoutingMode(input.defaultRoutingMode),
    agents,
    stages: asStages(input.stages),
    generatedAt: asString(input.generatedAt, "generatedAt"),
    source: {
      planner: "mock",
      answersPath:
        typeof (input.source as Record<string, unknown> | undefined)?.answersPath === "string"
          ? ((input.source as Record<string, unknown>).answersPath as string)
          : undefined
    },
    configPath
  };
}

export async function loadClusterConfig(): Promise<LoadedClusterConfig | null> {
  const configuredPath = process.env.AGENT_CLUSTER_CONFIG_PATH?.trim();
  if (!configuredPath) {
    return null;
  }

  const configPath = path.resolve(configuredPath);
  const content = await readFile(configPath, "utf8");
  return parseClusterConfig(JSON.parse(content), configPath);
}
