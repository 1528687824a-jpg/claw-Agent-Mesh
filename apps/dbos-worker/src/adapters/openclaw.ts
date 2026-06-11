import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OpenClawRunResult = {
  mode: "mock" | "real";
  sessionId: string;
  text: string;
  raw: unknown;
};

export type OpenClawProviderRuntime = {
  providerId: string | null;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
};

function openClawRealMode() {
  return process.env.OPENCLAW_AGENT_MODE === "real";
}

function getOpenClawCommand() {
  return process.env.OPENCLAW_CLI ?? "/home/administrator/.npm-global/bin/openclaw";
}

function getWslDistro() {
  return process.env.OPENCLAW_WSL_DISTRO ?? "Ubuntu-24.04";
}

function toOpenClawSessionId(sessionId: string) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "-");
}

function buildProviderEnv(provider?: OpenClawProviderRuntime | null) {
  if (!provider) {
    return {};
  }

  const env: Record<string, string> = {};
  if (provider.providerId) {
    env.HONEYCOMB_PROVIDER_ID = provider.providerId;
  }
  if (provider.baseUrl) {
    env.HONEYCOMB_PROVIDER_BASE_URL = provider.baseUrl;
    env.OPENAI_BASE_URL = provider.baseUrl;
  }
  if (provider.model) {
    env.HONEYCOMB_MODEL = provider.model;
    env.OPENAI_MODEL = provider.model;
  }
  if (provider.apiKey) {
    env.HONEYCOMB_PROVIDER_API_KEY = provider.apiKey;
    env.OPENAI_API_KEY = provider.apiKey;
    if (provider.providerId?.toLowerCase().includes("deepseek")) {
      env.DEEPSEEK_API_KEY = provider.apiKey;
    }
  }

  return env;
}

function extractText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    for (const key of ["text", "reply", "message", "content", "output"]) {
      if (typeof value[key] === "string") {
        return value[key] as string;
      }
    }

    if (Array.isArray(value.payloads)) {
      for (const payload of value.payloads) {
        if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).text === "string") {
          return (payload as Record<string, string>).text;
        }
      }
    }

    if (typeof value.finalAssistantVisibleText === "string") {
      return value.finalAssistantVisibleText;
    }

    if (typeof value.finalAssistantRawText === "string") {
      return value.finalAssistantRawText;
    }
  }

  return JSON.stringify(raw);
}

export async function runOpenClawAgent(input: {
  agentId: string;
  sessionId: string;
  message: string;
  provider?: OpenClawProviderRuntime | null;
  timeoutSeconds?: number;
}): Promise<OpenClawRunResult | null> {
  if (!openClawRealMode()) {
    return null;
  }
  const agentId = input.agentId;

  const args = [
    "-d",
    getWslDistro(),
    "--",
    getOpenClawCommand(),
    "agent",
    "--agent",
    agentId,
    "--session-id",
    toOpenClawSessionId(input.sessionId),
    "--message",
    input.message,
    "--json",
    "--timeout",
    String(input.timeoutSeconds ?? 600)
  ];

  const { stdout } = await execFileAsync("wsl", args, {
    env: {
      ...process.env,
      ...buildProviderEnv(input.provider)
    },
    maxBuffer: 20 * 1024 * 1024,
    timeout: (input.timeoutSeconds ?? 600) * 1000 + 30_000,
    windowsHide: true
  });

  const trimmed = stdout.trim();
  let raw: unknown = trimmed;

  try {
    raw = JSON.parse(trimmed);
  } catch {
    raw = trimmed;
  }

  return {
    mode: "real",
    sessionId: toOpenClawSessionId(input.sessionId),
    text: extractText(raw),
    raw
  };
}
