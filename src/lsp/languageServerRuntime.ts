/**
 * Snapshot of the *exact* runtime the Isabelle language client would
 * spawn right now: the resolved Isabelle executable plus its extra
 * arguments.
 *
 * Two callers need to agree on this snapshot:
 *
 *   1. `IsabelleLanguageClient.doStart`, which actually spawns the
 *      language server child process.
 *
 *   2. `resolveAutoStartFailureKey` in `extension.ts`, which derives the
 *      `workspaceState` key under which a previous auto-start failure
 *      is recorded.
 *
 * If those two readers ever disagreed, the per-runtime auto-start
 * failure memory could both mis-record (writing the failure under a key
 * for a runtime that was never actually spawned) and fail to clear
 * (when the user changes a setting that one side sees but the other
 * doesn't). Centralizing the resolution here makes that drift
 * impossible by construction.
 *
 * The helper is intentionally a pure module with no `vscode` import so
 * it can be unit-tested without a VS Code harness (see
 * `test/lsp/languageServerRuntime.test.ts`). Production callers pass in
 * the real `vscode.workspace.getConfiguration("isabelle")`, which
 * satisfies {@link RuntimeConfigSource} by structural typing.
 *
 * NB: configuration is read at workspace scope, not folder scope.
 * Folder-scoped overrides for `isabelle.executablePath` /
 * `isabelle.languageServer.extraArgs` are intentionally not honored
 * here yet; supporting them would also require the LSP client to spawn
 * a separate child per folder, which is out of scope for this change.
 * Track via a future issue if multi-root folder-aware runtimes are
 * needed.
 */

/**
 * The resolved runtime identity. `executable` is the value as returned
 * by the executable-path provider (the existing
 * `getIsabelleExecutablePath` helper in `extension.ts`) and is passed
 * verbatim to `buildLanguageServerCommand`, which is itself responsible
 * for the final `.trim()`. `extraArgs` is the type-filtered list of
 * strings from `isabelle.languageServer.extraArgs`.
 */
export interface ResolvedLanguageServerRuntime {
  readonly executable: string;
  readonly extraArgs: readonly string[];
}

/**
 * Structural subset of `vscode.WorkspaceConfiguration` that this helper
 * needs. Real callers pass `vscode.workspace.getConfiguration("isabelle")`
 * directly; tests pass a hand-rolled fake.
 */
export interface RuntimeConfigSource {
  get<T>(section: string, defaultValue: T): T;
  get<T>(section: string): T | undefined;
}

/**
 * Resolve the language server runtime in the same way that
 * `IsabelleLanguageClient.doStart` does today, but in one place so the
 * two consumers cannot drift.
 *
 * Parsing rules (must exactly match `doStart`'s current behaviour):
 *   - The executable string is whatever `executablePathProvider()`
 *     returns, untouched. Trimming happens later in
 *     `buildLanguageServerCommand`.
 *   - `languageServer.extraArgs` is read as `unknown`. If it is an
 *     array, each element is kept only when `typeof === "string"`
 *     (defensive against users hand-editing settings.json with
 *     non-string entries). If it is not an array, the resolved
 *     `extraArgs` is empty.
 */
export function resolveLanguageServerRuntime(
  executablePathProvider: () => string,
  config: RuntimeConfigSource
): ResolvedLanguageServerRuntime {
  const executable = executablePathProvider();
  const rawExtraArgs = config.get<unknown>("languageServer.extraArgs", []);
  const extraArgs = Array.isArray(rawExtraArgs)
    ? rawExtraArgs.filter((value): value is string => typeof value === "string")
    : [];
  return { executable, extraArgs };
}
