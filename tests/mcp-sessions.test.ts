import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import {
  McpSessionManager,
  McpToolError,
  mcpServerSessionFingerprint
} from "../apps/orchestrator-api/src/mcp-sessions";
import type { McpServerRecord } from "../packages/shared/src/types";

const FAKE_SERVER_PATH = path.join(__dirname, "fixtures", "fake-mcp-server.cjs");

function fakeServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: "fake-mcp",
    name: "Fake MCP",
    command: process.execPath,
    args: [FAKE_SERVER_PATH],
    envKeys: [],
    enabled: true,
    status: "available",
    lastCheckedAt: null,
    lastError: null,
    config: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function resultInstanceId(result: unknown): string {
  const record = result as Record<string, unknown>;
  assert.equal(typeof record.instanceId, "string");
  return record.instanceId as string;
}

const managers: McpSessionManager[] = [];

function newManager(options: ConstructorParameters<typeof McpSessionManager>[0] = {}) {
  const manager = new McpSessionManager({
    idleTimeoutMs: 60_000,
    sweepIntervalMs: 60_000,
    ...options
  });
  managers.push(manager);
  return manager;
}

after(() => {
  for (const manager of managers) {
    manager.closeAll();
  }
});

test("mcp session is reused across requests", async () => {
  const manager = newManager();
  const server = fakeServer();

  const first = await manager.request(server, "tools/call", {
    name: "echo",
    arguments: { value: 1 }
  });
  const second = await manager.request(server, "tools/call", {
    name: "echo",
    arguments: { value: 2 }
  });

  assert.equal(first.session.reusedSession, false);
  assert.equal(second.session.reusedSession, true);
  assert.equal(resultInstanceId(first.result), resultInstanceId(second.result));
  assert.equal(second.session.requestCount, 2);
  assert.equal(manager.stats().length, 1);
});

test("mcp session is replaced when server config changes", async () => {
  const manager = newManager();
  const server = fakeServer();

  const first = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  const changed = fakeServer({ envKeys: ["HONEYCOMB_FAKE_MCP_MARKER"] });
  assert.notEqual(mcpServerSessionFingerprint(server), mcpServerSessionFingerprint(changed));

  const second = await manager.request(changed, "tools/call", { name: "echo", arguments: {} });
  assert.notEqual(resultInstanceId(first.result), resultInstanceId(second.result));
  assert.equal(second.session.reusedSession, false);
});

test("mcp session recovers after server crash", async () => {
  const manager = newManager();
  const server = fakeServer();

  const first = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  await assert.rejects(
    manager.request(server, "tools/call", { name: "crash", arguments: {} }),
    (error: unknown) => error instanceof McpToolError && error.code === "mcp_process_exited"
  );
  assert.equal(manager.stats().length, 0);

  const second = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  assert.notEqual(resultInstanceId(first.result), resultInstanceId(second.result));
});

test("json-rpc error response keeps the session alive", async () => {
  const manager = newManager();
  const server = fakeServer();

  const first = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  await assert.rejects(
    manager.request(server, "tools/call", { name: "fail", arguments: {} }),
    (error: unknown) => error instanceof McpToolError && error.code === "mcp_request_failed"
  );

  const second = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  assert.equal(resultInstanceId(first.result), resultInstanceId(second.result));
  assert.equal(second.session.reusedSession, true);
});

test("idle sweep closes inactive sessions", async () => {
  const manager = newManager({ idleTimeoutMs: 1 });
  const server = fakeServer();

  const first = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const closed = manager.sweepIdleSessions();
  assert.equal(closed, 1);
  assert.equal(manager.stats().length, 0);

  const second = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  assert.notEqual(resultInstanceId(first.result), resultInstanceId(second.result));
});

test("request timeout destroys the session and the next call recovers", async () => {
  const manager = newManager();
  const server = fakeServer();

  await assert.rejects(
    manager.request(
      server,
      "tools/call",
      { name: "sleep", arguments: { ms: 10_000 } },
      { timeoutMs: 1000 }
    ),
    (error: unknown) => error instanceof McpToolError && error.code === "mcp_call_timeout"
  );
  assert.equal(manager.stats().length, 0);

  const recovered = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  assert.equal(recovered.session.reusedSession, false);
});

test("output limit destroys the session", async () => {
  const manager = newManager();
  const server = fakeServer();

  await assert.rejects(
    manager.request(
      server,
      "tools/call",
      { name: "big", arguments: { bytes: 200_000 } },
      { maxOutputBytes: 10_000 }
    ),
    (error: unknown) => error instanceof McpToolError && error.code === "mcp_output_limit_exceeded"
  );
  assert.equal(manager.stats().length, 0);
});

test("disabled server is rejected without opening a session", async () => {
  const manager = newManager();
  const server = fakeServer({ enabled: false });

  await assert.rejects(
    manager.request(server, "tools/call", { name: "echo", arguments: {} }),
    (error: unknown) => error instanceof McpToolError && error.code === "mcp_server_disabled"
  );
  assert.equal(manager.stats().length, 0);
});

test("explicit invalidation forces a fresh session", async () => {
  const manager = newManager();
  const server = fakeServer();

  const first = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  assert.equal(manager.invalidate(server.id), true);
  assert.equal(manager.invalidate(server.id), false);

  const second = await manager.request(server, "tools/call", { name: "echo", arguments: {} });
  assert.notEqual(resultInstanceId(first.result), resultInstanceId(second.result));
});
