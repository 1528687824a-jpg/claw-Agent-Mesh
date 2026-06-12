import {
  getModelProvider,
  listModelProviders,
  patchAgentConfig,
  seedDefaultAgentConfigs
} from "../../../packages/db/src/config-registry";
import {
  getProviderApiKeyStatus
} from "../../../packages/runtime/src/local-secrets";
import {
  applyOpenClawSyncPlan,
  OpenClawSyncSafetyError
} from "./openclaw-sync";
import {
  runOpenClawRuntimeCommand,
  type OpenClawRuntimeAction
} from "./openclaw-runtime-control";
import {
  PROVIDER_SECRET_MISSING_ERROR,
  withLiveProviderSecretStatuses
} from "./provider-secret-status";

export const RUNTIME_REPAIR_ACTION_IDS = [
  "providers.reconcileSecrets",
  "openclaw.runtime.start",
  "openclaw.runtime.restart",
  "agents.seedDefaults",
  "openclaw.sync.apply"
] as const;

export type RuntimeRepairActionId = (typeof RUNTIME_REPAIR_ACTION_IDS)[number];

export type RuntimeRepairAction = {
  id: RuntimeRepairActionId;
  title: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  inputs: string[];
};

export type RuntimeRepairInput = {
  action: RuntimeRepairActionId;
  rootPath?: string;
  timeoutMs?: number;
  providerId?: string | null;
  model?: string | null;
  panelAgentName?: string;
  allowDiscoveredUserRuntime?: boolean;
};

export type RuntimeRepairResult = {
  action: RuntimeRepairActionId;
  ranAt: string;
  ok: boolean;
  changed: boolean;
  summary: string;
  details: Record<string, unknown>;
};

export function listRuntimeRepairActions(): RuntimeRepairAction[] {
  return [
    {
      id: "providers.reconcileSecrets",
      title: "Reconcile provider secret status",
      description: "Refresh provider apiKeyConfigured/fingerprint state from local secret storage.",
      riskLevel: "low",
      inputs: []
    },
    {
      id: "openclaw.runtime.start",
      title: "Prepare/start OpenClaw runtime",
      description: "Run the configured or builtin OpenClaw start action for a runtime root.",
      riskLevel: "medium",
      inputs: ["rootPath", "timeoutMs"]
    },
    {
      id: "openclaw.runtime.restart",
      title: "Restart OpenClaw runtime",
      description: "Run the configured or builtin OpenClaw restart action for a runtime root.",
      riskLevel: "medium",
      inputs: ["rootPath", "timeoutMs"]
    },
    {
      id: "agents.seedDefaults",
      title: "Seed default Honeycomb agents",
      description: "Ensure the default panel, research, writer, image, video, and test agents exist.",
      riskLevel: "medium",
      inputs: ["providerId", "model", "panelAgentName"]
    },
    {
      id: "openclaw.sync.apply",
      title: "Apply OpenClaw sync plan",
      description: "Write Honeycomb agent prompts and redacted OpenClaw model/provider config files.",
      riskLevel: "high",
      inputs: ["rootPath", "allowDiscoveredUserRuntime"]
    }
  ];
}

function result(input: Omit<RuntimeRepairResult, "ranAt">): RuntimeRepairResult {
  return {
    ranAt: new Date().toISOString(),
    ...input
  };
}

async function repairProviderSecrets(action: RuntimeRepairActionId): Promise<RuntimeRepairResult> {
  const before = await listModelProviders();
  const after = await withLiveProviderSecretStatuses(before);
  const beforeById = new Map(before.map((provider) => [provider.id, provider]));
  const changedProviders = after
    .filter((provider) => {
      const previous = beforeById.get(provider.id);
      return (
        !previous ||
        previous.apiKeyConfigured !== provider.apiKeyConfigured ||
        previous.apiKeyFingerprint !== provider.apiKeyFingerprint ||
        previous.verificationStatus !== provider.verificationStatus ||
        previous.lastError !== provider.lastError
      );
    })
    .map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      apiKeyConfigured: provider.apiKeyConfigured,
      verificationStatus: provider.verificationStatus,
      lastError: provider.lastError
    }));

  return result({
    action,
    ok: true,
    changed: changedProviders.length > 0,
    summary:
      changedProviders.length > 0
        ? `Reconciled ${changedProviders.length} provider record(s).`
        : "Provider secret status was already in sync.",
    details: {
      totalProviders: after.length,
      configuredProviders: after.filter((provider) => provider.apiKeyConfigured).length,
      missingSecrets: after
        .filter((provider) => provider.lastError === PROVIDER_SECRET_MISSING_ERROR)
        .map((provider) => ({ id: provider.id, displayName: provider.displayName })),
      changedProviders
    }
  });
}

async function repairOpenClawRuntime(
  action: RuntimeRepairActionId,
  runtimeAction: OpenClawRuntimeAction,
  input: RuntimeRepairInput
): Promise<RuntimeRepairResult> {
  const command = await runOpenClawRuntimeCommand(runtimeAction, {
    rootPath: input.rootPath,
    timeoutMs: input.timeoutMs
  });
  return result({
    action,
    ok: command.ok,
    changed: command.ok,
    summary: command.ok ? `OpenClaw runtime ${runtimeAction} completed.` : `OpenClaw runtime ${runtimeAction} failed.`,
    details: {
      command
    }
  });
}

async function repairSeedDefaultAgents(input: RuntimeRepairInput): Promise<RuntimeRepairResult> {
  const provider = input.providerId ? await getModelProvider(input.providerId) : null;
  if (input.providerId && !provider) {
    return result({
      action: input.action,
      ok: false,
      changed: false,
      summary: "Provider was not found.",
      details: { providerId: input.providerId }
    });
  }

  const keyStatus = provider ? await getProviderApiKeyStatus(provider.id) : null;
  const agents = await seedDefaultAgentConfigs({
    panelAgentName: input.panelAgentName,
    providerId: provider?.id ?? input.providerId,
    model: input.model ?? provider?.defaultModel ?? null,
    apiKeyConfigured: keyStatus?.configured ?? provider?.apiKeyConfigured ?? false,
    apiKeyFingerprint: keyStatus?.fingerprint ?? provider?.apiKeyFingerprint ?? null
  });

  return result({
    action: input.action,
    ok: true,
    changed: true,
    summary: `Seeded or refreshed ${agents.length} default agent config(s).`,
    details: {
      agents: agents.map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        providerId: agent.providerId,
        model: agent.model,
        enabled: agent.enabled,
        openclawSyncStatus: agent.openclawSyncStatus
      }))
    }
  });
}

async function repairOpenClawSyncApply(input: RuntimeRepairInput): Promise<RuntimeRepairResult> {
  try {
    const applied = await applyOpenClawSyncPlan({
      rootPath: input.rootPath,
      allowDiscoveredUserRuntime: input.allowDiscoveredUserRuntime
    });
    if (!applied) {
      return result({
        action: input.action,
        ok: false,
        changed: false,
        summary: "OpenClaw runtime was not found.",
        details: {}
      });
    }

    await Promise.all(
      applied.plan.agents.map((agent) =>
        patchAgentConfig(agent.honeycombAgentId, {
          openclawSyncStatus: agent.status === "ready" ? "synced" : "failed",
          openclawAgentPath: agent.targetAgentPromptPath,
          lastSyncedAt: applied.appliedAt,
          lastError: agent.status === "ready" ? null : "missing_template"
        })
      )
    );

    return result({
      action: input.action,
      ok: true,
      changed: applied.writtenFiles.length > 0,
      summary: `Applied OpenClaw sync plan with ${applied.writtenFiles.length} written file(s).`,
      details: {
        rootPath: applied.plan.rootPath,
        rootSource: applied.plan.rootSource,
        writtenFileCount: applied.writtenFiles.length,
        skippedFileCount: applied.skippedFiles.length,
        agents: applied.plan.agents.map((agent) => ({
          honeycombAgentId: agent.honeycombAgentId,
          openclawAgentId: agent.openclawAgentId,
          status: agent.status,
          targetAgentPromptPath: agent.targetAgentPromptPath
        })),
        warnings: applied.plan.warnings
      }
    });
  } catch (error) {
    if (error instanceof OpenClawSyncSafetyError) {
      return result({
        action: input.action,
        ok: false,
        changed: false,
        summary: "OpenClaw sync was blocked by safety rules.",
        details: error.details
      });
    }
    throw error;
  }
}

export async function runRuntimeRepairAction(input: RuntimeRepairInput): Promise<RuntimeRepairResult> {
  switch (input.action) {
    case "providers.reconcileSecrets":
      return repairProviderSecrets(input.action);
    case "openclaw.runtime.start":
      return repairOpenClawRuntime(input.action, "start", input);
    case "openclaw.runtime.restart":
      return repairOpenClawRuntime(input.action, "restart", input);
    case "agents.seedDefaults":
      return repairSeedDefaultAgents(input);
    case "openclaw.sync.apply":
      return repairOpenClawSyncApply(input);
  }
}
