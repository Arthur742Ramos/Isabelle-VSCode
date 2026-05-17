import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import {
  IsabellePideMode,
  PideConfigureParams,
  PideConfigureResult
} from "../protocol/messages";
import { buildPideConfigureParams } from "./pideConfigure";

const PIDE_CONFIG_SECTION = "isabelle";
const PIDE_MODE_KEY = "isabelle.pide.mode";
const PIDE_CONFIG_CHANGE_SECTION = "isabelle.pide";

/**
 * Owns the `pide/configure` protocol exchange between the extension and the
 * Scala backend. Today the backend always keeps the local-syntax bridge
 * regardless of the configured mode; this service ships the plumbing so a
 * future PR can wire a real bridge swap without touching the extension.
 *
 * The service eagerly sends an initial `pide/configure` from [[start]] so the
 * backend knows the configured mode before any document operations arrive.
 * Configuration changes for any `isabelle.pide.*` key trigger a re-send.
 * In-flight identical requests are coalesced so the
 * command-update-and-listener path does not double-send.
 */
export class PideConfigurationService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private inflight: { signature: string; promise: Promise<PideConfigureResult> } | undefined;
  private started = false;
  private disposed = false;

  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel
  ) {}

  /**
   * Send the initial `pide/configure` request and subscribe to changes of
   * any `isabelle.pide.*` setting so subsequent edits propagate to the
   * backend. Safe to call once; subsequent calls are no-ops.
   */
  public start(): void {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(PIDE_CONFIG_CHANGE_SECTION)) {
          return;
        }
        void this.configureNow({ source: "config-change" });
      })
    );

    void this.configureNow({ source: "startup" });
  }

  /**
   * Read the current `isabelle.pide.*` settings and send a `pide/configure`
   * request. Errors are caught and logged so configuration-change listeners
   * never throw. When `showUserError` is true, also surface a non-modal
   * warning so user-invoked commands get visible feedback. Returns `true`
   * when the backend acknowledged the request, `false` otherwise.
   */
  public async configureNow(options: { source?: string; showUserError?: boolean } = {}): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    let signature: string;
    let promise: Promise<PideConfigureResult>;
    try {
      const params = buildPideConfigureParams(vscode.workspace.getConfiguration(PIDE_CONFIG_SECTION));
      signature = JSON.stringify(params);

      if (this.inflight && this.inflight.signature === signature) {
        try {
          await this.inflight.promise;
          return true;
        } catch {
          return false;
        }
      }

      promise = this.dispatch(params);
      this.inflight = { signature, promise };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`PIDE configure failed: ${message}`);
      if (options.showUserError) {
        void vscode.window.showWarningMessage(`Unable to send Isabelle PIDE configuration: ${message}`);
      }
      return false;
    }

    try {
      const result = await promise;
      const source = options.source ?? "configure";
      this.output.appendLine(
        `PIDE configure (${source}): mode=${result.mode}, activeBridge=${result.activeBridge}` +
          (result.message ? ` -- ${result.message}` : "")
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`PIDE configure failed: ${message}`);
      if (options.showUserError) {
        void vscode.window.showWarningMessage(`Unable to send Isabelle PIDE configuration: ${message}`);
      }
      return false;
    } finally {
      if (this.inflight && this.inflight.signature === signature && this.inflight.promise === promise) {
        this.inflight = undefined;
      }
    }
  }

  /**
   * Return the currently configured PIDE mode from VS Code settings,
   * falling back to `"localSyntax"` if the value is missing or unknown.
   */
  public getCurrentMode(): IsabellePideMode {
    return buildPideConfigureParams(vscode.workspace.getConfiguration(PIDE_CONFIG_SECTION)).mode;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private dispatch(params: PideConfigureParams): Promise<PideConfigureResult> {
    return this.backendManager
      .getClient()
      .request<PideConfigureResult, PideConfigureParams>("pide/configure", params);
  }
}

export const PIDE_CONFIGURATION_KEYS = {
  section: PIDE_CONFIG_SECTION,
  mode: PIDE_MODE_KEY,
  changeSection: PIDE_CONFIG_CHANGE_SECTION
} as const;
