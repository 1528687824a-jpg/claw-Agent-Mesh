import {
  getAgentConfig,
  getModelProvider,
  listAgentConfigs
} from "../../../packages/db/src/config-registry";
import { readProviderApiKey } from "../../orchestrator-api/src/local-secrets";
import type { AgentConfigRecord, ModelProviderRecord } from "../../../packages/shared/src/types";

export type AgentRuntimeRoute = {
  requestedAgentId: string;
  honeycombAgentId: string;
  openclawAgentId: string;
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

function metadataOpenClawAgentId(agent: AgentConfigRecord | null) {
  const value = agent?.metadata.openclawAgentId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    if (!input.agent.providerId) {
      warnings.push("provider_not_bound");
    }
  }

  if (input.agent?.providerId && !input.provider) {
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

export async function resolveAgentRuntime(input: {
  requestedAgentId: string;
}): Promise<AgentRuntimeSecrets> {
  const requestedAgentId = input.requestedAgentId.trim();
  const agent = await resolveAgentConfig(requestedAgentId);
  const provider = agent?.providerId ? await getModelProvider(agent.providerId) : null;
  const apiKey = provider ? await readProviderApiKey(provider.id) : null;
  const model = agent?.model ?? provider?.defaultModel ?? null;
  const openclawAgentId = metadataOpenClawAgentId(agent) ?? requestedAgentId;
  const warnings = buildWarnings({ agent, provider, apiKey, model });

  return {
    requestedAgentId,
    honeycombAgentId: agent?.id ?? requestedAgentId,
    openclawAgentId,
    displayName: agent?.displayName ?? null,
    agentRole: agent?.agentRole ?? null,
    providerId: provider?.id ?? agent?.providerId ?? null,
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

export function redactAgentRuntime(route: AgentRuntimeSecrets): AgentRuntimeRoute {
  const { apiKey: _apiKey, ...redacted } = route;
  return redacted;
}
