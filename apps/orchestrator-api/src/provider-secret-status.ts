import {
  patchModelProvider
} from "../../../packages/db/src/config-registry";
import {
  getProviderApiKeyStatus
} from "../../../packages/runtime/src/local-secrets";
import type { ModelProviderRecord } from "../../../packages/shared/src/types";

export const PROVIDER_SECRET_MISSING_ERROR = "provider_api_key_missing_in_secret_storage";

export async function withLiveProviderSecretStatus(provider: ModelProviderRecord): Promise<ModelProviderRecord> {
  const keyStatus = await getProviderApiKeyStatus(provider.id);
  if (
    provider.apiKeyConfigured === keyStatus.configured &&
    provider.apiKeyFingerprint === keyStatus.fingerprint
  ) {
    return provider;
  }

  const patched = await patchModelProvider(provider.id, {
    apiKeyConfigured: keyStatus.configured,
    apiKeyFingerprint: keyStatus.fingerprint,
    verificationStatus: keyStatus.configured ? provider.verificationStatus : "unknown",
    lastError: keyStatus.configured ? provider.lastError : PROVIDER_SECRET_MISSING_ERROR
  });

  return patched ?? {
    ...provider,
    apiKeyConfigured: keyStatus.configured,
    apiKeyFingerprint: keyStatus.fingerprint,
    verificationStatus: keyStatus.configured ? provider.verificationStatus : "unknown",
    lastError: keyStatus.configured ? provider.lastError : PROVIDER_SECRET_MISSING_ERROR
  };
}

export async function withLiveProviderSecretStatuses(providers: ModelProviderRecord[]) {
  return Promise.all(providers.map(withLiveProviderSecretStatus));
}
