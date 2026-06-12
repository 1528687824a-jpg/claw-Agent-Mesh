export type ProviderVerificationResult = {
  ok: boolean;
  status: "succeeded" | "failed";
  checkedAt: string;
  latencyMs: number;
  statusCode: number | null;
  message: string | null;
};

function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return `${normalized}/chat/completions`;
}

export async function verifyOpenAiCompatibleProvider(input: {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<ProviderVerificationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 20_000);
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const response = await fetch(chatCompletionsUrl(input.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          {
            role: "user",
            content: "Return only OK."
          }
        ],
        max_tokens: 2,
        temperature: 0,
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`.trim();
      try {
        const body = await response.json() as { error?: { message?: unknown }; message?: unknown };
        const remoteMessage =
          typeof body.error?.message === "string"
            ? body.error.message
            : typeof body.message === "string"
              ? body.message
              : null;
        if (remoteMessage) {
          message = `${message}: ${remoteMessage}`.slice(0, 500);
        }
      } catch {
        // Keep the status-only message. Do not echo raw provider bodies.
      }
      return {
        ok: false,
        status: "failed",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        statusCode: response.status,
        message
      };
    }

    return {
      ok: true,
      status: "succeeded",
      checkedAt,
      latencyMs: Date.now() - startedAt,
      statusCode: response.status,
      message: null
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      checkedAt,
      latencyMs: Date.now() - startedAt,
      statusCode: null,
      message: error instanceof Error ? error.message.slice(0, 500) : "provider_verification_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}
