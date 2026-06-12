import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOpenClawAgentArgs,
  extractOpenClawText,
  extractOpenClawUsage
} from "../apps/dbos-worker/src/adapters/openclaw";

test("extractOpenClawText accepts every recognized output shape", () => {
  assert.deepEqual(extractOpenClawText("plain reply"), {
    text: "plain reply",
    source: "string"
  });
  assert.deepEqual(extractOpenClawText({ text: "from text" }), {
    text: "from text",
    source: "field:text"
  });
  assert.deepEqual(extractOpenClawText({ reply: "from reply" }), {
    text: "from reply",
    source: "field:reply"
  });
  assert.deepEqual(extractOpenClawText({ payloads: [{ text: "from payloads" }] }), {
    text: "from payloads",
    source: "payloads"
  });
  assert.deepEqual(extractOpenClawText({ finalAssistantVisibleText: "from visible" }), {
    text: "from visible",
    source: "finalAssistantVisibleText"
  });
  assert.deepEqual(extractOpenClawText({ finalAssistantRawText: "from raw" }), {
    text: "from raw",
    source: "finalAssistantRawText"
  });
});

test("extractOpenClawText prefers direct fields over payloads", () => {
  assert.deepEqual(
    extractOpenClawText({ text: "direct", payloads: [{ text: "nested" }] }),
    { text: "direct", source: "field:text" }
  );
});

test("extractOpenClawText rejects empty and unrecognized output", () => {
  assert.equal(extractOpenClawText(""), null);
  assert.equal(extractOpenClawText("   "), null);
  assert.equal(extractOpenClawText(null), null);
  assert.equal(extractOpenClawText(42), null);
  assert.equal(extractOpenClawText({ status: "done" }), null);
  assert.equal(extractOpenClawText({ text: "   " }), null);
  assert.equal(extractOpenClawText({ payloads: [{ note: "no text" }] }), null);
});

test("extractOpenClawUsage normalizes every recognized usage shape", () => {
  assert.deepEqual(
    extractOpenClawUsage({ usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }),
    { promptTokens: 100, completionTokens: 40, totalTokens: 140 }
  );
  assert.deepEqual(
    extractOpenClawUsage({ usage: { promptTokens: 5, completionTokens: 7 } }),
    { promptTokens: 5, completionTokens: 7, totalTokens: 12 }
  );
  assert.deepEqual(
    extractOpenClawUsage({ usage: { input_tokens: 30, output_tokens: 12 } }),
    { promptTokens: 30, completionTokens: 12, totalTokens: 42 }
  );
  assert.deepEqual(
    extractOpenClawUsage({ tokenUsage: { promptTokens: 9, completionTokens: 1 } }),
    { promptTokens: 9, completionTokens: 1, totalTokens: 10 }
  );
  assert.deepEqual(
    extractOpenClawUsage({ meta: { usage: { prompt_tokens: 3, completion_tokens: 4 } } }),
    { promptTokens: 3, completionTokens: 4, totalTokens: 7 }
  );
});

test("extractOpenClawUsage rejects missing or invalid usage", () => {
  assert.equal(extractOpenClawUsage("plain text"), null);
  assert.equal(extractOpenClawUsage(null), null);
  assert.equal(extractOpenClawUsage({ text: "no usage here" }), null);
  assert.equal(extractOpenClawUsage({ usage: {} }), null);
  assert.equal(extractOpenClawUsage({ usage: { prompt_tokens: "not-a-number" } }), null);
  assert.equal(extractOpenClawUsage({ usage: { prompt_tokens: -5 } }), null);
});

test("buildOpenClawAgentArgs wraps the CLI in a Linux-side timeout", () => {
  const args = buildOpenClawAgentArgs({
    agentId: "research-agent",
    sessionId: "job:123/stage 4",
    message: "hello",
    timeoutSeconds: 600
  });

  const timeoutIndex = args.indexOf("timeout");
  assert.ok(timeoutIndex > args.indexOf("--"), "timeout wrapper runs inside the distro");
  assert.equal(args[timeoutIndex + 1], "--kill-after=5");
  assert.equal(args[timeoutIndex + 2], "605");

  assert.equal(args[args.indexOf("--session-id") + 1], "job-123-stage-4");
  assert.equal(args[args.indexOf("--timeout") + 1], "600");
  assert.equal(args[args.indexOf("--agent") + 1], "research-agent");
});
