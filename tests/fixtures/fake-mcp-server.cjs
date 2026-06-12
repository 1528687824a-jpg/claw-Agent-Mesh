// Minimal stdio MCP server used by tests/mcp-sessions.test.ts.
// Each process gets a random instanceId so tests can detect session reuse.
const readline = require("node:readline");
const crypto = require("node:crypto");

const instanceId = crypto.randomUUID();
let callCount = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined || id === null) {
    return;
  }

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        serverInfo: { name: "fake-mcp-server", version: "0.0.1" }
      }
    });
    return;
  }

  if (method === "tools/list") {
    callCount += 1;
    send({
      jsonrpc: "2.0",
      id,
      result: { tools: [{ name: "echo" }], instanceId, callCount }
    });
    return;
  }

  if (method === "tools/call") {
    const toolName = params && params.name;
    const args = (params && params.arguments) || {};

    if (toolName === "crash") {
      process.exit(7);
    }

    if (toolName === "fail") {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "fake tool failure" }
      });
      return;
    }

    if (toolName === "sleep") {
      setTimeout(() => {
        send({ jsonrpc: "2.0", id, result: { instanceId } });
      }, Number(args.ms ?? 1000));
      return;
    }

    if (toolName === "big") {
      send({
        jsonrpc: "2.0",
        id,
        result: { instanceId, blob: "x".repeat(Number(args.bytes ?? 300_000)) }
      });
      return;
    }

    callCount += 1;
    send({
      jsonrpc: "2.0",
      id,
      result: { instanceId, callCount, echo: args }
    });
    return;
  }

  send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `unknown method: ${method}` }
  });
});
