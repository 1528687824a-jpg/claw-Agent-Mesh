import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOpenClawAgentArgs,
  extractOpenClawText
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
