import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import net from "node:net";
import { performance } from "node:perf_hooks";

export class WebFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export type WebFetchInput = {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivateNetwork?: boolean;
};

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  displayCommand: string;
  redirectCount: number;
  statusCode: number;
  statusText: string;
  ok: boolean;
  contentType: string | null;
  contentLength: string | null;
  bodyText: string;
  byteLength: number;
  truncated: boolean;
  durationMs: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const HARD_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

type PinnedTarget = {
  address: string;
  family?: 4 | 6;
  hostname: string;
};

type PinnedHttpResponse = {
  statusCode: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  remoteAddress: string;
};

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value ?? fallback), min), max);
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isPrivateAddress(address: string) {
  const normalizedAddress = address.replace(/^\[(.*)\]$/, "$1");
  const family = net.isIP(normalizedAddress);
  if (family === 4) {
    return isPrivateIpv4(normalizedAddress);
  }
  if (family === 6) {
    return isPrivateIpv6(normalizedAddress);
  }
  return true;
}

export function normalizeWebFetchUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new WebFetchError("invalid_url", "URL must be a valid absolute URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WebFetchError("unsupported_protocol", "Only HTTP and HTTPS URLs are supported.", {
      protocol: parsed.protocol
    });
  }

  parsed.hash = "";
  return parsed.toString();
}

export function formatWebFetchCommand(url: string) {
  return `GET ${normalizeWebFetchUrl(url)}`;
}

async function resolvePinnedTarget(url: URL, allowPrivateNetwork: boolean): Promise<PinnedTarget> {
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    if (!allowPrivateNetwork) {
      throw new WebFetchError("private_network_blocked", "Private network targets require explicit approval.", {
        hostname
      });
    }
  }

  const directIp = net.isIP(hostname);
  if (directIp) {
    if (!allowPrivateNetwork && isPrivateAddress(hostname)) {
      throw new WebFetchError("private_network_blocked", "Private network targets require explicit approval.", {
        hostname
      });
    }
    return {
      address: hostname,
      family: directIp as 4 | 6,
      hostname
    };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true });
  } catch (error) {
    throw new WebFetchError("dns_lookup_failed", "Could not resolve web fetch target.", {
      hostname,
      message: error instanceof Error ? error.message : "dns_lookup_failed"
    });
  }

  if (records.length === 0) {
    throw new WebFetchError("dns_lookup_failed", "Could not resolve web fetch target.", {
      hostname
    });
  }

  const privateRecords = records.filter((record) => isPrivateAddress(record.address));
  if (!allowPrivateNetwork && privateRecords.length > 0) {
    throw new WebFetchError("private_network_blocked", "Private network targets require explicit approval.", {
      hostname,
      addresses: privateRecords.map((record) => record.address)
    });
  }

  const selected = records.find((record) => allowPrivateNetwork || !isPrivateAddress(record.address)) ?? records[0];
  return {
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
    hostname
  };
}

function headerValue(headers: http.IncomingHttpHeaders, name: string) {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

async function readResponseBody(response: http.IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let truncated = false;

  for await (const value of response) {
    const chunk = Buffer.from(value);
    const remaining = maxBytes - byteLength;
    if (chunk.length > remaining) {
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining));
        byteLength += remaining;
      }
      truncated = true;
      break;
    }

    chunks.push(chunk);
    byteLength += chunk.length;
  }

  return { body: Buffer.concat(chunks, byteLength), truncated };
}

function requestPinnedUrl(
  url: URL,
  target: PinnedTarget,
  input: {
    timeoutMs: number;
    maxBytes: number;
    signal: AbortSignal;
  }
): Promise<PinnedHttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
    const options: http.RequestOptions & https.RequestOptions = {
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
        host: url.host,
        "user-agent": "Honeycomb/0.1 local-agent-panel"
      },
      timeout: input.timeoutMs
    };

    if (url.protocol === "https:" && net.isIP(target.hostname) === 0) {
      options.servername = target.hostname;
    }

    const request = transport.request(options, async (response) => {
      try {
        const { body, truncated } = await readResponseBody(response, input.maxBytes);
        resolve({
          statusCode: response.statusCode ?? 0,
          statusText: response.statusMessage ?? "",
          headers: response.headers,
          body,
          truncated,
          remoteAddress: target.address
        });
      } catch (error) {
        reject(error);
      }
    });

    const abort = () => request.destroy(new Error("web_fetch_aborted"));
    if (input.signal.aborted) {
      abort();
      return;
    }
    input.signal.addEventListener("abort", abort, { once: true });
    request.on("timeout", () => request.destroy(new Error("web_fetch_timeout")));
    request.on("error", reject);
    request.on("close", () => input.signal.removeEventListener("abort", abort));
    request.end();
  });
}

export async function runWebFetch(input: WebFetchInput): Promise<WebFetchResult> {
  const normalizedUrl = normalizeWebFetchUrl(input.url);
  const timeoutMs = clampNumber(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 60_000);
  const maxBytes = clampNumber(input.maxBytes, DEFAULT_MAX_BYTES, 1, HARD_MAX_BYTES);
  const allowPrivateNetwork = input.allowPrivateNetwork === true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    let currentUrl = normalizedUrl;
    let redirectCount = 0;
    let response: PinnedHttpResponse;

    for (;;) {
      const parsed = new URL(currentUrl);
      const target = await resolvePinnedTarget(parsed, allowPrivateNetwork);

      response = await requestPinnedUrl(parsed, target, {
        timeoutMs,
        maxBytes,
        signal: controller.signal
      });

      if (![301, 302, 303, 307, 308].includes(response.statusCode)) {
        break;
      }

      const location = headerValue(response.headers, "location");
      if (!location) {
        break;
      }

      redirectCount += 1;
      if (redirectCount > MAX_REDIRECTS) {
        throw new WebFetchError("too_many_redirects", "Web fetch exceeded the redirect limit.", {
          maxRedirects: MAX_REDIRECTS
        });
      }

      currentUrl = normalizeWebFetchUrl(new URL(String(location), currentUrl).toString());
    }

    return {
      url: normalizedUrl,
      finalUrl: currentUrl,
      displayCommand: formatWebFetchCommand(normalizedUrl),
      redirectCount,
      statusCode: response.statusCode,
      statusText: response.statusText,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      contentType: String(headerValue(response.headers, "content-type") ?? "") || null,
      contentLength: String(headerValue(response.headers, "content-length") ?? "") || null,
      bodyText: response.body.toString("utf8"),
      byteLength: response.body.length,
      truncated: response.truncated,
      durationMs: Math.round(performance.now() - startedAt)
    };
  } catch (error) {
    if (error instanceof WebFetchError) {
      throw error;
    }
    throw new WebFetchError(
      "web_fetch_failed",
      error instanceof Error ? error.message : "Web fetch failed."
    );
  } finally {
    clearTimeout(timeout);
  }
}
