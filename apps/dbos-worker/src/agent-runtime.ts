import {
  getAgentConfig,
  getModelProvider,
  listAgentConfigs
} from "../../../packages/db/src/config-registry";
import { readProviderApiKey } from "../../../packages/runtime/src/local-secrets";
import type { AgentConfigRecord, ModelProviderRecord } from "../../../packages/shared/src/types";

export type AgentRuntimeRoute = {
  requestedAgentId: string;
  honeycombAgentId: string;
  openclawAgentId: string;
  routeSource: "primary" | "agent_metadata" | "provider_metadata";
  routePriority: number;
  displayName: string | null;
  agentRole: string | null;
  providerId: string | null;
  providerDisplayName: string | null;
  providerBaseUrl: string | null;
  providerVerificationStatus: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  apiKeyFingerprint: string | null;
  warnings: string[];
};

export type AgentRuntimeSecrets = AgentRuntimeRoute & {
  apiKey: string | null;
};

export type AgentRuntimeFallbackRouteSpec = {
  providerId: string;
  model: string | null;
  source: "agent_metadata" | "provider_metadata";
  priority: number;
};

function metadataOpenClawAgentId(agent: AgentConfigRecord | null) {
  const value = agent?.metadata.openclawAgentId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function metadataFallbackSpecs(
  metadata: Record<string, unknown> | null | undefined,
  source: "agent_metadata" | "provider_metadata",
  startPriority = 1
): AgentRuntimeFallbackRouteSpec[] {
  const specs: AgentRuntimeFallbackRouteSpec[] = [];
  const keys = ["fallbackRoutes", "fallbackProviderIds", "providerFallbacks", "fallbacks"];
  for (const key of keys) {
    const value = metadata?.[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      const record = recordValue(item);
      const providerId =
        stringValue(item) ??
        stringValue(record?.providerId) ??
        stringValue(record?.id) ??
        stringValue(record?.provider);
      if (!providerId) {
        continue;
      }
      specs.push({
        providerId,
        model: stringValue(record?.model) ?? stringValue(record?.defaultModel),
        source,
        priority: startPriority + specs.length
      });
    }
  }
  return specs;
}

function isPanelAgentAlias(agentId: string) {
  const configuredAlias = process.env.HONEYCOMB_PANEL_SUPERVISOR_AGENT_ID?.trim();
  return (
    agentId === "panel-agent" ||
    agentId === "main-agent" ||
    agentId === "panel-supervisor-agent" ||
    (Boolean(configuredAlias) && agentId === configuredAlias)
  );
}

async function resolveAgentConfig(requestedAgentId: string) {
  if (isPanelAgentAlias(requestedAgentId)) {
    const panelAgent = await getAgentConfig("panel-agent");
    if (panelAgent) {
      return panelAgent;
    }
  }

  const directAgent = await getAgentConfig(requestedAgentId);
  if (directAgent) {
    return directAgent;
  }

  const agents = await listAgentConfigs();
  return agents.find((agent) => metadataOpenClawAgentId(agent) === requestedAgentId) ?? null;
}

function buildWarnings(input: {
  agent: AgentConfigRecord | null;
  provider: ModelProviderRecord | null;
  providerId: string | null;
  apiKey: string | null;
  model: string | null;
}) {
  const warnings: string[] = [];
  if (!input.agent) {
    warnings.push("agent_config_not_found");
  } else {
    if (!input.agent.enabled) {
      warnings.push("agent_disabled");
    }
    if (!input.providerId) {
      warnings.push("provider_not_bound");
    }
  }

  if (input.providerId && !input.provider) {
    warnings.push("provider_not_found");
  }
  if (input.provider && input.provider.verificationStatus !== "succeeded") {
    warnings.push(`provider_verification_${input.provider.verificationStatus}`);
  }
  if (input.provider && !input.apiKey) {
    warnings.push("provider_api_key_missing");
  }
  if (!input.model) {
    warnings.push("model_not_configured");
  }

  return warnings;
}

async function buildRoute(input: {
  requestedAgentId: string;
  agent: AgentConfigRecord | null;
  providerId: string | null;
  modelOverride?: string | null;
  source: "primary" | "agent_metadata" | "provider_metadata";
  priority: number;
}): Promise<AgentRuntimeSecrets> {
  const provider = input.providerId ? await getModelProvider(input.providerId) : null;
  const apiKey = provider ? await readProviderApiKey(provider.id) : null;
  const model = input.modelOverride ?? input.agent?.model ?? provider?.defaultModel ?? null;
  const openclawAgentId = metadataOpenClawAgentId(input.agent) ?? input.requestedAgentId;
  const warnings = buildWarnings({
    agent: input.agent,
    provider,
    providerId: input.providerId,
    apiKey,
    model
  });

  return {
    requestedAgentId: input.requestedAgentId,
    honeycombAgentId: input.agent?.id ?? input.requestedAgentId,
    openclawAgentId,
    routeSource: input.source,
    routePriority: input.priority,
    displayName: input.agent?.displayName ?? null,
    agentRole: input.agent?.agentRole ?? null,
    providerId: provider?.id ?? input.providerId,
    providerDisplayName: provider?.displayName ?? null,
    providerBaseUrl: provider?.baseUrl ?? null,
    providerVerificationStatus: provider?.verificationStatus ?? null,
    model,
    apiKeyConfigured: Boolean(apiKey),
    apiKeyFingerprint: apiKey ? provider?.apiKeyFingerprint ?? null : null,
    apiKey,
    warnings
  };
}

export async function resolveAgentRuntimeCandidates(input: {
  requestedAgentId: string;
}): Promise<AgentRuntimeSecrets[]> {
  const requestedAgentId = input.requestedAgentId.trim();
  const agent = await resolveAgentConfig(requestedAgentId);
  const primaryProviderId = agent?.providerId ?? null;
  const primaryProvider = primaryProviderId ? await getModelProvider(primaryProviderId) : null;
  const fallbackSpecs = [
    ...metadataFallbackSpecs(agent?.metadata, "agent_metadata"),
    ...metadataFallbackSpecs(primaryProvider?.metadata, "provider_metadata", 100)
  ];
  const seen = new Set<string>();
  const primary = await buildRoute({
    requestedAgentId,
    agent,
    providerId: primaryProviderId,
    modelOverride: agent?.model ?? null,
    source: "primary",
    priority: 0
  });
  seen.add(`${primary.providerId ?? ""}\u0000${primary.model ?? ""}`);

  const candidates = [primary];
  for (const spec of fallbackSpecs) {
    const candidate = await buildRoute({
        requestedAgentId,
        agent,
        providerId: spec.providerId,
        modelOverride: spec.model,
        source: spec.source,
        priority: spec.priority
      });
    const key = `${candidate.providerId ?? ""}\u0000${candidate.model ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(candidate);
  }

  return candidates;
}

export async function resolveAgentRuntime(input: {
  requestedAgentId: string;
}): Promise<AgentRuntimeSecrets> {
  const [primary] = await resolveAgentRuntimeCandidates(input);
  return primary;
}

export function redactAgentRuntime(route: AgentRuntimeSecrets): AgentRuntimeRoute {
  const { apiKey: _apiKey, ...redacted } = route;
  return redacted;
}
