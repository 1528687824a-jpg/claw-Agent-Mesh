import { lookup } from "node:dns/promises";
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

async function assertPublicTarget(url: URL, allowPrivateNetwork: boolean) {
  if (allowPrivateNetwork) {
    return;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new WebFetchError("private_network_blocked", "Private network targets require explicit approval.", {
      hostname
    });
  }

  const directIp = net.isIP(hostname);
  if (directIp && isPrivateAddress(hostname)) {
    throw new WebFetchError("private_network_blocked", "Private network targets require explicit approval.", {
      hostname
    });
  }

  if (!directIp) {
    const records = await lookup(hostname, { all: true });
    const privateRecords = records.filter((record) => isPrivateAddress(record.address));
    if (privateRecords.length > 0) {
      throw new WebFetchError("private_network_blocked", "Private network targets require explicit approval.", {
        hostname,
        addresses: privateRecords.map((record) => record.address)
      });
    }
  }
}

async function readResponseBody(response: Response, maxBytes: number) {
  if (!response.body) {
    return { body: Buffer.alloc(0), truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }

    const chunk = Buffer.from(value);
    const remaining = maxBytes - byteLength;
    if (chunk.length > remaining) {
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining));
        byteLength += remaining;
      }
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(chunk);
    byteLength += chunk.length;
  }

  return { body: Buffer.concat(chunks, byteLength), truncated };
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
    let response: Response;

    for (;;) {
      const parsed = new URL(currentUrl);
      await assertPublicTarget(parsed, allowPrivateNetwork);

      response = await fetch(currentUrl, {
        method: "GET",
        headers: {
          accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
          "user-agent": "Honeycomb/0.1 local-agent-panel"
        },
        redirect: "manual",
        signal: controller.signal
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        break;
      }

      const location = response.headers.get("location");
      if (!location) {
        break;
      }

      redirectCount += 1;
      if (redirectCount > MAX_REDIRECTS) {
        throw new WebFetchError("too_many_redirects", "Web fetch exceeded the redirect limit.", {
          maxRedirects: MAX_REDIRECTS
        });
      }

      currentUrl = normalizeWebFetchUrl(new URL(location, currentUrl).toString());
    }

    const { body, truncated } = await readResponseBody(response, maxBytes);
    return {
      url: normalizedUrl,
      finalUrl: response.url,
      displayCommand: formatWebFetchCommand(normalizedUrl),
      redirectCount,
      statusCode: response.status,
      statusText: response.statusText,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      bodyText: body.toString("utf8"),
      byteLength: body.length,
      truncated,
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
