// Two-step PIDE/sledgehammer_sendback -> PIDE/sledgehammer_insert
// helper. Encapsulates the round-trip described in research
// recommendation #5 (docs/sledgehammer_lsp_research.md), keeping the
// vscode-facing edit-application layer thin and testable.
//
// Wire-level dance (verbatim from the research note):
//   client -> server: PIDE/sledgehammer_sendback { text: <proof text> }
//   server -> client: PIDE/sledgehammer_insert
//                     { uri: string, line: int, character: int, text: string }
//
// `line` and `character` are zero-based LSP positions (UTF-16 code units,
// per LSP §3.17 §Position) and map directly to `new vscode.Position(line,
// character)`.
//
// None of the `PIDE/sledgehammer_*` notifications carry a correlation id,
// so the helper assumes single-flight: callers must serialize
// sendback round-trips, just as they already serialize the surrounding
// Sledgehammer runs (see `LspSledgehammerSession`'s single-slot
// contract).

import {
  SessionClient,
  SessionDisposable
} from "./LspSledgehammerSession";

export const PIDE_SLEDGEHAMMER_SENDBACK_METHOD = "PIDE/sledgehammer_sendback";
export const PIDE_SLEDGEHAMMER_INSERT_METHOD = "PIDE/sledgehammer_insert";

/** Default cap on how long to wait for `PIDE/sledgehammer_insert`. */
export const DEFAULT_PIDE_INSERT_TIMEOUT_MS = 5_000;

export interface PideInsertPayload {
  readonly uri: string;
  readonly line: number;
  readonly character: number;
  readonly text: string;
}

export type ValidateInsertResult =
  | { readonly ok: true; readonly payload: PideInsertPayload }
  | { readonly ok: false; readonly reason: string };

export type RequestPideInsertResult =
  | { readonly ok: true; readonly payload: PideInsertPayload }
  | { readonly ok: false; readonly reason: string };

export interface RequestPideInsertOptions {
  /** URI of the theory the suggestion will be inserted into. */
  readonly uri: string;
  /** Timeout in milliseconds (defaults to {@link DEFAULT_PIDE_INSERT_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
}

/**
 * Validate one inbound `PIDE/sledgehammer_insert` payload. Coerces
 * hostile or malformed shapes to a typed failure rather than throwing,
 * and rejects mismatched URIs / negative / non-finite positions.
 */
export function validatePideInsertPayload(
  value: unknown,
  expectedUri: string
): ValidateInsertResult {
  if (!isInsertPayload(value)) {
    return {
      ok: false,
      reason: `Malformed ${PIDE_SLEDGEHAMMER_INSERT_METHOD} payload`
    };
  }
  if (value.uri !== expectedUri) {
    return {
      ok: false,
      reason: `URI mismatch: expected ${expectedUri}, got ${value.uri}`
    };
  }
  if (!Number.isFinite(value.line) || !Number.isFinite(value.character)) {
    return {
      ok: false,
      reason: `Non-finite position (${value.line}:${value.character})`
    };
  }
  if (
    value.line < 0 ||
    value.character < 0 ||
    !Number.isInteger(value.line) ||
    !Number.isInteger(value.character)
  ) {
    return {
      ok: false,
      reason: `Invalid position (${value.line}:${value.character}); expected non-negative integers`
    };
  }
  return { ok: true, payload: value };
}

/**
 * Send `PIDE/sledgehammer_sendback` and wait for the server's
 * `PIDE/sledgehammer_insert` reply. Resolves with the validated
 * payload on success or a typed `reason` on timeout / malformed
 * payload / URI mismatch / send failure.
 *
 * The promise NEVER rejects: every outcome is returned through the
 * result discriminated union so the caller has a single shape to
 * branch on.
 */
export function requestPideInsert(
  client: SessionClient,
  proofText: string,
  options: RequestPideInsertOptions
): Promise<RequestPideInsertResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PIDE_INSERT_TIMEOUT_MS;
  return new Promise<RequestPideInsertResult>((resolve) => {
    let settled = false;
    let subscription: SessionDisposable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: RequestPideInsertResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      subscription?.dispose();
      subscription = undefined;
      resolve(result);
    };

    try {
      subscription = client.onNotification(
        PIDE_SLEDGEHAMMER_INSERT_METHOD,
        (params) => {
          const validation = validatePideInsertPayload(params, options.uri);
          if (validation.ok) {
            settle({ ok: true, payload: validation.payload });
          } else {
            // Drop malformed/mismatched replies but keep waiting —
            // the server might send a valid one next. Fall through
            // to the timeout if it never does. This matches the
            // upstream single-slot semantics: there is no correlation
            // id, so we can't tell whether a malformed reply is for
            // us or for a previous run leftover.
          }
        }
      );
    } catch (error) {
      settle({
        ok: false,
        reason: `Failed to subscribe to ${PIDE_SLEDGEHAMMER_INSERT_METHOD}: ${errorMessage(error)}`
      });
      return;
    }

    timer = setTimeout(() => {
      settle({
        ok: false,
        reason: `Timed out after ${timeoutMs} ms waiting for ${PIDE_SLEDGEHAMMER_INSERT_METHOD}`
      });
    }, timeoutMs);
    timer.unref?.();

    try {
      client.sendNotification(PIDE_SLEDGEHAMMER_SENDBACK_METHOD, {
        text: proofText
      });
    } catch (error) {
      settle({
        ok: false,
        reason: `Failed to send ${PIDE_SLEDGEHAMMER_SENDBACK_METHOD}: ${errorMessage(error)}`
      });
    }
  });
}

function isInsertPayload(value: unknown): value is PideInsertPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.uri === "string" &&
    typeof candidate.line === "number" &&
    typeof candidate.character === "number" &&
    typeof candidate.text === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
