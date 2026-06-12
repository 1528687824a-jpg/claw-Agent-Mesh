import { spawn } from "node:child_process";
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

function runPowerShellDpapi(action: "protect" | "unprotect", base64Input: string) {
  const script =
    action === "protect"
      ? `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$inputText=[Console]::In.ReadToEnd().Trim();$bytes=[Convert]::FromBase64String($inputText);$protected=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($protected))`
      : `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$inputText=[Console]::In.ReadToEnd().Trim();$bytes=[Convert]::FromBase64String($inputText);$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($plain))`;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      }
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `DPAPI ${action} failed`));
    });
    child.stdin.end(base64Input);
  });
}

async function encryptSecret(secret: string) {
  if (process.platform !== "win32") {
    return {
      format: "plaintext-local-v1",
      value: Buffer.from(secret, "utf8").toString("base64")
    };
  }

  return {
    format: "dpapi-user-v1",
    ciphertext: await runPowerShellDpapi("protect", Buffer.from(secret, "utf8").toString("base64"))
  };
}

async function decryptSecret(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.format === "dpapi-user-v1" && typeof record.ciphertext === "string") {
    const decrypted = await runPowerShellDpapi("unprotect", record.ciphertext);
    return Buffer.from(decrypted, "base64").toString("utf8");
  }

  if (record.format === "plaintext-local-v1" && typeof record.value === "string") {
    return Buffer.from(record.value, "base64").toString("utf8");
  }

  return null;
}

export function fingerprintSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

export async function saveProviderApiKey(providerId: string, apiKey: string) {
  const filePath = providerSecretPath(providerId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(await encryptSecret(apiKey), null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  return {
    configured: true,
    fingerprint: fingerprintSecret(apiKey)
  };
}

export async function readProviderApiKey(providerId: string) {
  const filePath = providerSecretPath(providerId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      const decrypted = await decryptSecret(JSON.parse(raw));
      if (decrypted !== null) {
        return decrypted;
      }
    } catch {
      // Fall through to legacy plaintext migration.
    }

    const legacy = raw.trim();
    if (!legacy) {
      return null;
    }
    await saveProviderApiKey(providerId, legacy);
    return legacy;
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
