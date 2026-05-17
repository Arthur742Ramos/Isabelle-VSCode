import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Structural pins for `PideDecorationOverlayService` — the live
 * vscode-side wiring around the upstream `PIDE/decoration` notification.
 *
 * The pure policy helpers (`groupDecorationEntriesByKnownType`,
 * `planDecorationRequests`, `parsePideDecorationPayload`) are covered
 * by `test/document/pideDecorations.test.ts`. The pins below catch
 * regressions that would only show up in a live VS Code session with
 * an Isabelle install — i.e. they fail at build time rather than only
 * during a Tier-2 manual run.
 */

const serviceSourcePath = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "document",
  "PideDecorationOverlayService.ts"
);
const serviceSource = readFileSync(serviceSourcePath, "utf8");

const extensionSourcePath = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "extension.ts"
);
const extensionSource = readFileSync(extensionSourcePath, "utf8");

describe("PideDecorationOverlayService structural wiring", () => {
  it("subscribes to PIDE/decoration via onNotification", () => {
    expect(serviceSource).toMatch(/onNotification\(\s*PIDE_DECORATION_METHOD/);
  });

  it("sends PIDE/decoration_request via sendNotification", () => {
    expect(serviceSource).toMatch(/sendNotification\(\s*PIDE_DECORATION_REQUEST_METHOD/);
  });

  it("clears per-URI cache and disposes decoration types on dispose", () => {
    // Both the per-URI cache and the per-type decoration registry must
    // be released on dispose so the extension's stop/start cycle does
    // not leak TextEditorDecorationType instances or cached payloads.
    expect(serviceSource).toMatch(/decorationType\.dispose\(\)/);
    expect(serviceSource).toMatch(/this\.decorationTypes\.clear\(\)/);
    expect(serviceSource).toMatch(/this\.entriesByUri\.clear\(\)/);
  });

  it("tears down the PIDE/decoration subscription when LSP leaves `running`", () => {
    // The teardown path must dispose the notification subscription so a
    // restart cycle does not leak overlapping handlers across LSP runs.
    expect(serviceSource).toMatch(/notificationSubscription\?\.dispose\(\)/);
    expect(serviceSource).toMatch(/tearDownLspSession/);
  });

  it("clears the painted decorations from visible editors when LSP transitions out of running", () => {
    expect(serviceSource).toMatch(/clearAllPaintedDecorations/);
  });

  it("paints visible editors with an empty entries array when no cache exists, to avoid stale overlays", () => {
    // The rubber-duck review caught the bug where a re-shown editor
    // could retain old decorations until the server responded; the
    // fix is to call paintEditor with [] when no cache is present.
    expect(serviceSource).toContain(
      "this.entriesByUri.get(editor.document.uri.toString()) ?? []"
    );
  });

  it("evicts cache entries for URIs that are neither visible nor open", () => {
    expect(serviceSource).toMatch(/evictUnreachableCache/);
  });

  it("guards every public callback against disposal", () => {
    // Every handler must early-return when disposed so a queued event
    // does not interact with a torn-down editor / dead decoration type.
    const handlerGuards = serviceSource.match(/if \(this\.disposed\) return/g) ?? [];
    expect(handlerGuards.length).toBeGreaterThanOrEqual(5);
  });
});

describe("PideDecorationOverlayService wired into extension activation", () => {
  it("constructs the service in activate() with the language client and output channel", () => {
    expect(extensionSource).toMatch(
      /pideDecorationOverlayService\s*=\s*new PideDecorationOverlayService\(languageClient,\s*output\)/
    );
  });

  it("starts the service in the same activation block as other decoration services", () => {
    expect(extensionSource).toMatch(/pideDecorationOverlayService\.start\(\)/);
  });

  it("is included in the activation subscriptions list so disposal happens with the extension", () => {
    expect(extensionSource).toMatch(/\bpideDecorationOverlayService\b/);
  });

  it("is disposed in deactivate() before backend teardown", () => {
    expect(extensionSource).toMatch(/pideDecorationOverlayService\?\.dispose\(\)/);
    expect(extensionSource).toMatch(/pideDecorationOverlayService = undefined/);
  });
});
