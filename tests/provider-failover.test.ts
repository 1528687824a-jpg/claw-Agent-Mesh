import assert from "node:assert/strict";
import { test } from "node:test";
import { metadataFallbackSpecs } from "../apps/dbos-worker/src/agent-runtime";
import { verifyOpenAiCompatibleProvider } from "../apps/orchestrator-api/src/provider-verification";

test("metadata fallback specs accept route objects and provider id strings", () => {
  assert.deepEqual(
    metadataFallbackSpecs(
      {
        fallbackRoutes: [
          { providerId: "provider-fast", model: "fast-model" },
          { id: "provider-cheap", defaultModel: "cheap-model" },
          "provider-last"
        ],
        fallbackProviderIds: ["provider-string-list"]
      },
      "agent_metadata",
      10
    ),
    [
      {
        providerId: "provider-fast",
        model: "fast-model",
        source: "agent_metadata",
        priority: 10
      },
      {
        providerId: "provider-cheap",
        model: "cheap-model",
        source: "agent_metadata",
        priority: 11
      },
      {
        providerId: "provider-last",
        model: null,
        source: "agent_metadata",
        priority: 12
      },
      {
        providerId: "provider-string-list",
        model: null,
        source: "agent_metadata",
        priority: 13
      }
    ]
  );
});

test("provider verification reports latency and uses OpenAI-compatible chat completions", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl: string | URL | Request | null = null;
  let requestedBody: Record<string, unknown> | null = null;
  let requestedAuthorization: string | null = null;

  globalThis.fetch = (async (url, init) => {
    requestedUrl = url;
    requestedAuthorization = new Headers(init?.headers).get("authorization");
    requestedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await verifyOpenAiCompatibleProvider({
      baseUrl: "https://provider.example/v1/",
      model: "model-a",
      apiKey: "sk-test"
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "succeeded");
    assert.equal(result.statusCode, 200);
    assert.equal(result.message, null);
    assert.equal(Number.isInteger(result.latencyMs), true);
    assert.ok(result.latencyMs >= 0);
    assert.equal(String(requestedUrl), "https://provider.example/v1/chat/completions");
    assert.equal(requestedAuthorization, "Bearer sk-test");
    assert.equal(requestedBody?.model, "model-a");
    assert.equal(requestedBody?.stream, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
