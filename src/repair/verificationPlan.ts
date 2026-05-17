export interface RepairVerificationPatchSummary {
  relativePath: string;
  hunkCount: number;
}

export interface RepairVerificationSessionSnapshot {
  name: string;
  parent?: string;
  rootDirectory: string;
  sessionDirectory: string;
}

export interface RepairVerificationBuildSnapshot {
  command: string;
  args: string[];
  workingDirectory: string;
}

export interface RepairVerificationContext {
  session: RepairVerificationSessionSnapshot;
  build: RepairVerificationBuildSnapshot;
}

export interface RepairVerificationPlanSnapshot {
  capturedAt: string;
  workspaceFolder: string;
  patchPath?: string;
  patches: RepairVerificationPatchSummary[];
  verification?: RepairVerificationContext;
}

export function buildRepairVerificationPlanMarkdown(snapshot: RepairVerificationPlanSnapshot): string {
  return [
    "# Isabelle repair verification plan",
    "",
    "This plan was generated locally for a proposed repair patch. It is not a verification result: no patch contents were applied, no files were written, and no Isabelle build was run by the preview command.",
    "",
    "## Status",
    "",
    "- State: Not verified yet.",
    "- Required check: apply the trusted patch manually, then run `Isabelle: Check Current Workspace for Repair` or the Isabelle build command below.",
    "- Success criteria: only treat the repair as checked after that build exits with code 0 on workspace files that include the proposed repair.",
    "",
    "## Patch",
    "",
    snapshot.patchPath ? `- Patch file: \`${inlineCode(snapshot.patchPath)}\`` : "- Patch file: not recorded",
    `- Workspace folder: \`${inlineCode(snapshot.workspaceFolder)}\``,
    `- Captured at: ${snapshot.capturedAt}`,
    "",
    renderPatchSummary(snapshot.patches),
    "",
    "## Active session and build",
    "",
    renderVerification(snapshot.verification),
    "",
    "## Safe workflow",
    "",
    "1. Review the readonly diff preview. The preview command did not modify files.",
    "2. Apply the trusted edit yourself using VS Code or another editor.",
    "3. Run the active-session build from this plan, or run `Isabelle: Check Current Workspace for Repair`.",
    "4. Report the repair as checked only if Isabelle completes that build successfully after the manual edit is present.",
    ""
  ].join("\n");
}

function renderPatchSummary(patches: RepairVerificationPatchSummary[]): string {
  if (patches.length === 0) {
    return "No patch entries were recorded.";
  }

  return patches
    .map((patch, index) => `${index + 1}. \`${inlineCode(patch.relativePath)}\` (${formatHunks(patch.hunkCount)})`)
    .join("\n");
}

function renderVerification(verification: RepairVerificationContext | undefined): string {
  if (!verification) {
    return [
      "No active Isabelle session was selected when this plan was generated.",
      "",
      "Select an active session, then run `Isabelle: Check Current Workspace for Repair` after manually applying the trusted edit. Until that build succeeds, the repair is not verified."
    ].join("\n");
  }

  return [
    `- Session: \`${inlineCode(verification.session.name)}\``,
    verification.session.parent ? `- Parent session: \`${inlineCode(verification.session.parent)}\`` : undefined,
    `- Root directory: \`${inlineCode(verification.session.rootDirectory)}\``,
    `- Session directory: \`${inlineCode(verification.session.sessionDirectory)}\``,
    `- Working directory: \`${inlineCode(verification.build.workingDirectory)}\``,
    `- Command line: \`${inlineCode(formatCommandLine(verification.build))}\``,
    "",
    "Arguments:",
    "",
    "```json",
    JSON.stringify(verification.build.args, null, 2),
    "```"
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatHunks(count: number): string {
  return `${count} ${count === 1 ? "hunk" : "hunks"}`;
}

function formatCommandLine(build: RepairVerificationBuildSnapshot): string {
  return [build.command, ...build.args].map(quoteCommandPart).join(" ");
}

function quoteCommandPart(value: string): string {
  if (value.length > 0 && /^[^\s"]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function inlineCode(value: string): string {
  return value.replace(/`/g, "\\`");
}
