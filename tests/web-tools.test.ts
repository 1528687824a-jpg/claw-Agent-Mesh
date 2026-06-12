import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { normalizeWebFetchUrl, runWebFetch, WebFetchError } from "../apps/orchestrator-api/src/web-tools";

const servers: http.Server[] = [];

after(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

function listen(server: http.Server) {
  servers.push(server);
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("missing_test_server_port"));
        return;
      }
      resolve(address.port);
    });
  });
}

test("normalizeWebFetchUrl keeps only supported absolute HTTP URLs", () => {
  assert.equal(normalizeWebFetchUrl("https://example.com/path#fragment"), "https://example.com/path");
  assert.throws(() => normalizeWebFetchUrl("file:///tmp/example"), WebFetchError);
});

test("runWebFetch blocks private network targets by default", async () => {
  await assert.rejects(
    () => runWebFetch({ url: "http://127.0.0.1:1/health" }),
    (error) => error instanceof WebFetchError && error.code === "private_network_blocked"
  );
});

test("runWebFetch can fetch an explicitly approved private target", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  const port = await listen(server);

  const result = await runWebFetch({
    url: `http://127.0.0.1:${port}/health`,
    allowPrivateNetwork: true,
    maxBytes: 64
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.bodyText, "ok");
  assert.equal(result.truncated, false);
});
