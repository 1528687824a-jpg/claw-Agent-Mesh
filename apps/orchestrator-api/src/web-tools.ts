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

export type WebSearchInput = {
  query: string;
  endpointUrl?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxResults?: number;
  allowPrivateNetwork?: boolean;
};

export type BrowserSnapshotInput = {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxLinks?: number;
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

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string | null;
};

export type WebSearchResult = {
  query: string;
  searchUrl: string;
  displayCommand: string;
  results: WebSearchResultItem[];
  fetch: Omit<WebFetchResult, "bodyText"> & {
    bodyPreview: string;
  };
};

export type BrowserSnapshotResult = {
  url: string;
  finalUrl: string;
  displayCommand: string;
  title: string | null;
  textPreview: string;
  links: Array<{
    text: string;
    url: string;
  }>;
  fetch: Omit<WebFetchResult, "bodyText"> & {
    bodyPreview: string;
  };
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

function normalizeSearchQuery(query: string) {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new WebFetchError("invalid_search_query", "Search query must not be empty.");
  }
  if (trimmed.length > 500) {
    throw new WebFetchError("search_query_too_long", "Search query is too long.");
  }
  return trimmed;
}

function defaultSearchEndpoint() {
  return process.env.HONEYCOMB_WEB_SEARCH_ENDPOINT?.trim() || "https://duckduckgo.com/html/?q={query}";
}

export function buildWebSearchUrl(query: string, endpointUrl = defaultSearchEndpoint()) {
  const normalizedQuery = normalizeSearchQuery(query);
  const endpoint = endpointUrl.includes("{query}")
    ? endpointUrl.replace(/\{query\}/g, encodeURIComponent(normalizedQuery))
    : (() => {
      const parsed = new URL(normalizeWebFetchUrl(endpointUrl));
      parsed.searchParams.set("q", normalizedQuery);
      return parsed.toString();
    })();
  return normalizeWebFetchUrl(endpoint);
}

export function formatWebSearchCommand(query: string, endpointUrl = defaultSearchEndpoint()) {
  return `SEARCH ${normalizeSearchQuery(query)} VIA ${buildWebSearchUrl(query, endpointUrl)}`;
}

export function formatBrowserSnapshotCommand(url: string) {
  return `SNAPSHOT ${normalizeWebFetchUrl(url)}`;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attributeValue(attributes: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = attributes.match(pattern);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null;
}

function absoluteHttpUrl(href: string, baseUrl: string) {
  try {
    const resolved = new URL(decodeHtmlEntities(href), baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return null;
  }
}

function extractTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? stripHtml(match[1] ?? "") : "";
  return title || null;
}

function extractLinks(html: string, baseUrl: string, maxLinks: number) {
  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = attributeValue(match[1] ?? "", "href");
    if (!href) {
      continue;
    }
    const url = absoluteHttpUrl(href, baseUrl);
    if (!url || seen.has(url)) {
      continue;
    }
    const text = stripHtml(match[2] ?? "");
    if (!text) {
      continue;
    }
    seen.add(url);
    links.push({ text: text.slice(0, 240), url });
    if (links.length >= maxLinks) {
      break;
    }
  }
  return links;
}

function searchResultsFromHtml(html: string, baseUrl: string, maxResults: number) {
  return extractLinks(html, baseUrl, maxResults)
    .filter((link) => !/duckduckgo\.com\/(y\.js|html|lite|settings|feedback)/i.test(link.url))
    .map((link) => ({
      title: link.text,
      url: link.url,
      snippet: null
    }));
}

function fetchSummary(fetch: WebFetchResult) {
  const { bodyText: _bodyText, ...rest } = fetch;
  return {
    ...rest,
    bodyPreview: fetch.bodyText.slice(0, 4000)
  };
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

export async function runWebSearch(input: WebSearchInput): Promise<WebSearchResult> {
  const query = normalizeSearchQuery(input.query);
  const searchUrl = buildWebSearchUrl(query, input.endpointUrl);
  const maxResults = clampNumber(input.maxResults, 8, 1, 20);
  const fetch = await runWebFetch({
    url: searchUrl,
    timeoutMs: input.timeoutMs,
    maxBytes: input.maxBytes,
    allowPrivateNetwork: input.allowPrivateNetwork
  });

  return {
    query,
    searchUrl,
    displayCommand: formatWebSearchCommand(query, input.endpointUrl),
    results: searchResultsFromHtml(fetch.bodyText, fetch.finalUrl, maxResults),
    fetch: fetchSummary(fetch)
  };
}

export async function runBrowserSnapshot(input: BrowserSnapshotInput): Promise<BrowserSnapshotResult> {
  const normalizedUrl = normalizeWebFetchUrl(input.url);
  const maxLinks = clampNumber(input.maxLinks, 20, 0, 100);
  const fetch = await runWebFetch({
    url: normalizedUrl,
    timeoutMs: input.timeoutMs,
    maxBytes: input.maxBytes,
    allowPrivateNetwork: input.allowPrivateNetwork
  });
  const text = stripHtml(fetch.bodyText);

  return {
    url: normalizedUrl,
    finalUrl: fetch.finalUrl,
    displayCommand: formatBrowserSnapshotCommand(normalizedUrl),
    title: extractTitle(fetch.bodyText),
    textPreview: text.slice(0, 4000),
    links: extractLinks(fetch.bodyText, fetch.finalUrl, maxLinks),
    fetch: fetchSummary(fetch)
  };
}
