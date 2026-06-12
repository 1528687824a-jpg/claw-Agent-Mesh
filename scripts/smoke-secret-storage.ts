import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), ".runtime", `secret-storage-smoke-${randomUUID()}`);
process.env.HONEYCOMB_SECRET_DIR = root;

async function main() {
  const { readProviderApiKey, saveProviderApiKey } = await import("../packages/runtime/src/local-secrets");

  const providerId = "smoke-provider";
  const marker = `sk-honeycomb-smoke-${randomUUID()}`;
  await saveProviderApiKey(providerId, marker);

  const readBack = await readProviderApiKey(providerId);
  if (readBack !== marker) {
    throw new Error("secret_storage_readback_failed");
  }

  const raw = await fs.readFile(path.join(root, "providers", `${providerId}.key`), "utf8");
  if (raw.includes(marker)) {
    throw new Error("secret_storage_contains_plaintext");
  }

  if (process.platform === "win32" && !raw.includes('"format": "dpapi-user-v1"')) {
    throw new Error("secret_storage_not_dpapi");
  }

  console.log(JSON.stringify({
    ok: true,
    providerId,
    format: process.platform === "win32" ? "dpapi-user-v1" : "plaintext-local-v1",
    plaintextPresent: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
