// Namespaced wrapper around `vscode.SecretStorage` so AI repair
// providers can persist credentials without each provider rolling
// its own key-naming scheme. See docs/AI_REPAIR.md for the higher-
// level seam this module supports.
//
// Storage keys follow the shape:
//
//   isabelle.repair.aiSecret.<providerId>
//
// where `providerId` matches the same id the registry uses. Provider
// ids are normalised before they hit storage so a hostile caller
// (e.g. an id with embedded whitespace or unusual characters) can
// neither collide with another provider's key nor escape the
// namespace.
//
// The module is `vscode`-free: callers pass any object satisfying
// `SecretStorageLike`. The production wiring passes
// `context.secrets`.

export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/** Prefix used for every key written by this helper. */
export const REPAIR_AI_SECRET_KEY_PREFIX = "isabelle.repair.aiSecret.";

/**
 * Build the namespaced storage key for a given provider id. Throws
 * on invalid ids so the namespace can never be escaped: empty,
 * whitespace-only, or containing characters that we don't allow in
 * a provider id (anything outside `[A-Za-z0-9._-]`).
 *
 * The allowed character set matches the publisher/extension id
 * convention used by the VS Code marketplace; provider authors are
 * expected to namespace their ids the same way.
 */
export function buildRepairAiSecretKey(providerId: string): string {
  if (typeof providerId !== "string") {
    throw new Error("buildRepairAiSecretKey: providerId must be a string");
  }
  const trimmed = providerId.trim();
  if (trimmed.length === 0) {
    throw new Error("buildRepairAiSecretKey: providerId must be non-empty");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(
      `buildRepairAiSecretKey: providerId "${providerId}" contains characters outside [A-Za-z0-9._-]`
    );
  }
  return `${REPAIR_AI_SECRET_KEY_PREFIX}${trimmed}`;
}

/**
 * High-level façade over a `SecretStorageLike` for AI repair
 * credentials. Providers should consume this rather than going
 * directly to VS Code's secret store so the key shape stays
 * consistent across providers.
 */
export class RepairAiSecretStore {
  public constructor(private readonly storage: SecretStorageLike) {}

  /** Returns the stored secret for `providerId`, or undefined if none. */
  public async get(providerId: string): Promise<string | undefined> {
    const key = buildRepairAiSecretKey(providerId);
    return this.storage.get(key);
  }

  /**
   * Stores `secret` for `providerId`. Empty secrets are treated as
   * "delete the existing entry" so a UI flow that clears the input
   * field DTRT without a separate `delete` command.
   */
  public async set(providerId: string, secret: string): Promise<void> {
    const key = buildRepairAiSecretKey(providerId);
    if (typeof secret !== "string") {
      throw new Error(
        `RepairAiSecretStore.set: secret for provider "${providerId}" must be a string`
      );
    }
    if (secret.length === 0) {
      await this.storage.delete(key);
      return;
    }
    await this.storage.store(key, secret);
  }

  /** Deletes the stored secret for `providerId`. No-op if none exists. */
  public async clear(providerId: string): Promise<void> {
    const key = buildRepairAiSecretKey(providerId);
    await this.storage.delete(key);
  }
}
