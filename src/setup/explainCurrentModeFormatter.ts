/**
 * Markdown formatter for the `Isabelle: Explain Current Mode` output channel.
 *
 * Kept separate from {@link buildExplainModeReport} so future surfaces
 * (status bar tooltip, webview, copyable plain text) can render the same
 * report differently without dragging Markdown specifics through the pure
 * report module.
 *
 * Production wiring lives in `src/extension.ts`; tests live in
 * `test/setup/explainCurrentModeFormatter.test.ts`.
 */

import {
  ExplainModeIsabelleReport,
  ExplainModeJavaReport,
  ExplainModeLanguageServerReport,
  ExplainModeNextStep,
  ExplainModeReport
} from "./explainCurrentMode";

const SEPARATOR = "──────────────────────────────────────────────────";

export function formatExplainModeReport(report: ExplainModeReport): string {
  const nextStepLines = formatNextSteps(report.pideFeatures.nextSteps);
  const lines: string[] = [
    SEPARATOR,
    "Isabelle PIDE — current mode",
    SEPARATOR,
    "",
    `PIDE features: ${report.pideFeatures.available ? "AVAILABLE" : "UNAVAILABLE"}`,
    `  ${report.pideFeatures.reason}`,
    "",
    "Backend:",
    `  State: ${report.backend.state}`,
    `  Configured command: ${report.backend.commandSetting ?? "(default — bundled jar)"}`,
    "",
    ...formatLanguageServerSection(report.languageServer),
    "",
    `Active session: ${report.activeSession ?? "(none)"}`,
    "",
    ...formatJavaSection(report.java),
    "",
    ...formatIsabelleSection(report.isabelle),
    ...(nextStepLines.length > 0 ? ["", ...nextStepLines] : []),
    "",
    SEPARATOR,
    "Tip: re-run `Isabelle: Check Setup Prerequisites` for a fresh probe of Java and Isabelle.",
    SEPARATOR
  ];
  return lines.join("\n");
}

function formatLanguageServerSection(ls: ExplainModeLanguageServerReport): string[] {
  const lines: string[] = ["Language server:", `  State: ${ls.state}`];
  lines.push(`  Setting: isabelle.languageServer.enabled = ${ls.enabledSetting}`);
  lines.push(`  Auto-start: ${ls.autoStart ? "enabled" : "disabled"}`);
  if (ls.extraArgs.length > 0) {
    lines.push(`  Extra args: ${ls.extraArgs.map(quoteArg).join(" ")}`);
  }
  lines.push(
    `  Auto-start failure remembered: ${ls.autoStartFailure.remembered ? "yes" : "no"}`
  );
  if (ls.autoStartFailure.key) {
    lines.push(`  Auto-start failure key: ${ls.autoStartFailure.key}`);
  }
  if (ls.isabelleVersion) {
    lines.push(`  Isabelle version (per LSP): ${ls.isabelleVersion}`);
  }
  if (ls.commandLine) {
    lines.push(`  Command line: ${ls.commandLine}`);
  }
  if (ls.lastStartedAt) {
    lines.push(`  Last started: ${ls.lastStartedAt}`);
  }
  if (ls.lastStoppedAt) {
    lines.push(`  Last stopped: ${ls.lastStoppedAt}`);
  }
  if (ls.lastError) {
    lines.push(`  Last error: ${ls.lastError}`);
  }
  return lines;
}

function formatNextSteps(nextSteps: readonly ExplainModeNextStep[]): string[] {
  if (nextSteps.length === 0) return [];
  return [
    "Next steps:",
    ...nextSteps.map((nextStep, index) => `  ${index + 1}. ${nextStep.label}`)
  ];
}

function quoteArg(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function formatJavaSection(java: ExplainModeJavaReport): string[] {
  const lines: string[] = ["Java:"];
  if (!java.available) {
    if (java.tooOld) {
      lines.push(`  Status: too old (Java ${java.versionMajor ?? "?"}, need 21+)`);
    } else {
      lines.push("  Status: not found");
    }
  } else {
    lines.push(`  Status: ok (Java ${java.versionMajor ?? "?"})`);
  }
  if (java.command) {
    lines.push(`  Command: ${java.command}`);
  }
  if (java.version) {
    lines.push(`  Version line: ${java.version}`);
  }
  if (java.bundled !== undefined) {
    lines.push(`  Source: ${java.bundled ? "bundled (.vsix)" : "system PATH"}`);
  }
  return lines;
}

function formatIsabelleSection(isabelle: ExplainModeIsabelleReport): string[] {
  const lines: string[] = ["Isabelle:"];
  lines.push(`  Status: ${isabelle.available ? "ok" : "not found"}`);
  lines.push(`  Setting: isabelle.executablePath = ${isabelle.executablePathSetting}`);
  if (isabelle.path) {
    lines.push(`  Resolved path: ${isabelle.path}`);
  }
  if (isabelle.version) {
    lines.push(`  Version: ${isabelle.version}`);
  }
  if (isabelle.detectedFallbackPath) {
    lines.push(`  Detected fallback: ${isabelle.detectedFallbackPath}`);
  }
  return lines;
}
