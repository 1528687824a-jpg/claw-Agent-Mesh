import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import {
  buildWebSearchUrl,
  normalizeWebFetchUrl,
  runBrowserSnapshot,
  runWebFetch,
  runWebSearch,
  WebFetchError
} from "../apps/orchestrator-api/src/web-tools";

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

test("runWebSearch uses a configurable endpoint and extracts result links", async () => {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, "/search?q=honeycomb+agents");
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <html>
        <body>
          <a href="https://example.com/a">First result</a>
          <a href="/local">Local result</a>
        </body>
      </html>
    `);
  });
  const port = await listen(server);
  const endpointUrl = `http://127.0.0.1:${port}/search`;

  assert.equal(
    buildWebSearchUrl("honeycomb agents", endpointUrl),
    `http://127.0.0.1:${port}/search?q=honeycomb+agents`
  );

  const result = await runWebSearch({
    query: "honeycomb agents",
    endpointUrl,
    allowPrivateNetwork: true,
    maxResults: 2
  });

  assert.equal(result.query, "honeycomb agents");
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0], {
    title: "First result",
    url: "https://example.com/a",
    snippet: null
  });
  assert.equal(result.results[1]?.url, `http://127.0.0.1:${port}/local`);
});

test("runBrowserSnapshot extracts title, readable text, and links", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <html>
        <head><title>Snapshot Page</title><style>.hidden{display:none}</style></head>
        <body>
          <h1>Hello Honeycomb</h1>
          <script>window.secret = true;</script>
          <a href="/next">Next page</a>
        </body>
      </html>
    `);
  });
  const port = await listen(server);

  const result = await runBrowserSnapshot({
    url: `http://127.0.0.1:${port}/page`,
    allowPrivateNetwork: true,
    maxLinks: 5
  });

  assert.equal(result.title, "Snapshot Page");
  assert.match(result.textPreview, /Hello Honeycomb/);
  assert.doesNotMatch(result.textPreview, /window.secret/);
  assert.deepEqual(result.links, [
    {
      text: "Next page",
      url: `http://127.0.0.1:${port}/next`
    }
  ]);
});
