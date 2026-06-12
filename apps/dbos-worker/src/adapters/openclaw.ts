import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OpenClawRunResult = {
  mode: "mock" | "real";
  sessionId: string;
  text: string;
  textSource: OpenClawTextSource;
  raw: unknown;
};

export type OpenClawProviderRuntime = {
  providerId: string | null;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
};

export type OpenClawTextSource =
  | "string"
  | "field:text"
  | "field:reply"
  | "field:message"
  | "field:content"
  | "field:output"
  | "payloads"
  | "finalAssistantVisibleText"
  | "finalAssistantRawText";

export class OpenClawOutputError extends Error {
  constructor(
    message: string,
    readonly stdoutPreview: string
  ) {
    super(message);
  }
}

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

export function extractOpenClawText(raw: unknown): {
  text: string;
  source: OpenClawTextSource;
} | null {
  if (typeof raw === "string") {
    return raw.trim() ? { text: raw, source: "string" } : null;
  }

  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    for (const key of ["text", "reply", "message", "content", "output"] as const) {
      if (typeof value[key] === "string" && (value[key] as string).trim()) {
        return { text: value[key] as string, source: `field:${key}` };
      }
    }

    if (Array.isArray(value.payloads)) {
      for (const payload of value.payloads) {
        if (
          payload &&
          typeof payload === "object" &&
          typeof (payload as Record<string, unknown>).text === "string" &&
          ((payload as Record<string, unknown>).text as string).trim()
        ) {
          return { text: (payload as Record<string, string>).text, source: "payloads" };
        }
      }
    }

    if (typeof value.finalAssistantVisibleText === "string" && value.finalAssistantVisibleText.trim()) {
      return { text: value.finalAssistantVisibleText, source: "finalAssistantVisibleText" };
    }

    if (typeof value.finalAssistantRawText === "string" && value.finalAssistantRawText.trim()) {
      return { text: value.finalAssistantRawText, source: "finalAssistantRawText" };
    }
  }

  return null;
}

export function buildOpenClawAgentArgs(input: {
  agentId: string;
  sessionId: string;
  message: string;
  timeoutSeconds: number;
}) {
  // The Linux-side `timeout` wrapper guarantees cleanup of the WSL process
  // tree: the outer execFile timeout only kills wsl.exe on the Windows side,
  // which can leave the CLI running inside the distro.
  return [
    "-d",
    getWslDistro(),
    "--",
    "timeout",
    "--kill-after=5",
    String(input.timeoutSeconds + 5),
    getOpenClawCommand(),
    "agent",
    "--agent",
    input.agentId,
    "--session-id",
    toOpenClawSessionId(input.sessionId),
    "--message",
    input.message,
    "--json",
    "--timeout",
    String(input.timeoutSeconds)
  ];
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

  const timeoutSeconds = input.timeoutSeconds ?? 600;
  const args = buildOpenClawAgentArgs({
    agentId: input.agentId,
    sessionId: input.sessionId,
    message: input.message,
    timeoutSeconds
  });

  const { stdout } = await execFileAsync("wsl", args, {
    env: {
      ...process.env,
      ...buildProviderEnv(input.provider)
    },
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutSeconds * 1000 + 30_000,
    windowsHide: true
  });

  const trimmed = stdout.trim();
  let raw: unknown = trimmed;

  try {
    raw = JSON.parse(trimmed);
  } catch {
    raw = trimmed;
  }

  const extracted = extractOpenClawText(raw);
  if (!extracted) {
    throw new OpenClawOutputError(
      "OpenClaw returned empty or unrecognized output; expected a text/reply/message/content/output/payloads field.",
      trimmed.slice(0, 2000)
    );
  }

  return {
    mode: "real",
    sessionId: toOpenClawSessionId(input.sessionId),
    text: extracted.text,
    textSource: extracted.source,
    raw
  };
}
