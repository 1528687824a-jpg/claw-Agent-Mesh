import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function secretRoot() {
  return (
    process.env.HONEYCOMB_SECRET_DIR ||
    path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "io.agentopenclaw.desktop",
      "honeycomb-secrets"
    )
  );
}

function safeName(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function providerSecretPath(providerId: string) {
  return path.join(secretRoot(), "providers", `${safeName(providerId)}.key`);
}

export function fingerprintSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

export async function saveProviderApiKey(providerId: string, apiKey: string) {
  const filePath = providerSecretPath(providerId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, apiKey, { encoding: "utf8", mode: 0o600 });
  return {
    configured: true,
    fingerprint: fingerprintSecret(apiKey)
  };
}

export async function readProviderApiKey(providerId: string) {
  try {
    return await fs.readFile(providerSecretPath(providerId), "utf8");
  } catch {
    return null;
  }
}

export async function getProviderApiKeyStatus(providerId: string) {
  const apiKey = await readProviderApiKey(providerId);
  return {
    configured: Boolean(apiKey),
    fingerprint: apiKey ? fingerprintSecret(apiKey) : null
  };
}
