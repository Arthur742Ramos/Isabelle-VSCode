export interface UnifiedDiffLine {
  kind: "context" | "add" | "remove";
  text: string;
}

export interface UnifiedDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: UnifiedDiffLine[];
}

export interface UnifiedDiffFilePatch {
  relativePath: string;
  hunks: UnifiedDiffHunk[];
}

export interface UnifiedDiffPreview {
  relativePath: string;
  proposedText: string;
  hunkCount: number;
}

export class RepairPatchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RepairPatchError";
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(patchText: string): UnifiedDiffFilePatch[] {
  const lines = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const patches: UnifiedDiffFilePatch[] = [];
  let current: UnifiedDiffFilePatch | undefined;

  for (let index = 0; index < lines.length;) {
    const line = lines[index];

    rejectUnsupportedMetadata(line);

    if (line.startsWith("--- ")) {
      const oldPath = normalizePatchPath(line.slice(4));
      index++;
      if (index >= lines.length || !lines[index].startsWith("+++ ")) {
        throw new RepairPatchError("Patch file header is missing a matching +++ line.");
      }

      const newPath = normalizePatchPath(lines[index].slice(4));
      if (oldPath !== newPath) {
        throw new RepairPatchError("Patch previews do not support renames or cross-file edits.");
      }

      current = {
        relativePath: oldPath,
        hunks: []
      };
      patches.push(current);
      index++;
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (!current) {
        throw new RepairPatchError("Patch hunk appears before a file header.");
      }

      const hunkHeader = HUNK_HEADER.exec(line);
      if (!hunkHeader) {
        throw new RepairPatchError(`Unsupported hunk header: ${line}`);
      }

      const hunk: UnifiedDiffHunk = {
        oldStart: Number(hunkHeader[1]),
        oldCount: parseHunkCount(hunkHeader[2]),
        newStart: Number(hunkHeader[3]),
        newCount: parseHunkCount(hunkHeader[4]),
        lines: []
      };

      if (hunk.oldStart < 1 || hunk.newStart < 1) {
        throw new RepairPatchError("Patch previews require existing file hunks; new-file hunks are not supported.");
      }

      index++;
      while (index < lines.length) {
        const hunkLine = lines[index];
        if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("--- ") || hunkLine.startsWith("diff --git ")) {
          break;
        }

        if (hunkLine.startsWith("\\")) {
          throw new RepairPatchError("Patch previews do not support no-newline markers.");
        }

        const prefix = hunkLine[0];
        if (prefix !== " " && prefix !== "+" && prefix !== "-") {
          if (hunkLine.length === 0 && index === lines.length - 1) {
            break;
          }
          throw new RepairPatchError(`Unsupported patch line in hunk: ${hunkLine}`);
        }

        hunk.lines.push({
          kind: prefix === " " ? "context" : prefix === "+" ? "add" : "remove",
          text: hunkLine.slice(1)
        });
        index++;
      }

      verifyHunkCounts(hunk);
      current.hunks.push(hunk);
      continue;
    }

    index++;
  }

  if (patches.length === 0) {
    throw new RepairPatchError("Patch contains no unified-diff file entries.");
  }

  for (const patch of patches) {
    if (patch.hunks.length === 0) {
      throw new RepairPatchError(`Patch for ${patch.relativePath} contains no hunks.`);
    }
  }

  return patches;
}

export function createUnifiedDiffPreviews(
  patchText: string,
  originals: Map<string, string> | Record<string, string>
): UnifiedDiffPreview[] {
  return parseUnifiedDiff(patchText).map((patch) => ({
    relativePath: patch.relativePath,
    proposedText: applyUnifiedDiffPatch(patch, getOriginalText(originals, patch.relativePath)),
    hunkCount: patch.hunks.length
  }));
}

export function applyUnifiedDiffPatch(patch: UnifiedDiffFilePatch, originalText: string): string {
  const original = splitText(originalText);
  const result: string[] = [];
  let cursor = 0;

  for (const hunk of patch.hunks) {
    const hunkStart = hunk.oldStart - 1;
    if (hunkStart < cursor) {
      throw new RepairPatchError(`Overlapping hunk in ${patch.relativePath}.`);
    }
    if (hunkStart > original.lines.length) {
      throw new RepairPatchError(`Hunk starts past the end of ${patch.relativePath}.`);
    }

    result.push(...original.lines.slice(cursor, hunkStart));
    let originalCursor = hunkStart;

    for (const line of hunk.lines) {
      if (line.kind === "add") {
        result.push(line.text);
        continue;
      }

      const actual = original.lines[originalCursor];
      if (actual === undefined || compareLine(actual, line.text, originalCursor) !== true) {
        throw new RepairPatchError(`Patch context does not match ${patch.relativePath} at line ${originalCursor + 1}.`);
      }

      if (line.kind === "context") {
        result.push(actual);
      }
      originalCursor++;
    }

    cursor = originalCursor;
  }

  result.push(...original.lines.slice(cursor));

  let proposed = result.join(original.eol);
  if (original.hasFinalNewline) {
    proposed += original.eol;
  }
  if (original.hasBom && proposed.length > 0 && !proposed.startsWith("\uFEFF")) {
    proposed = `\uFEFF${proposed}`;
  }
  return proposed;
}

export function normalizePatchPath(rawPath: string): string {
  const withoutTimestamp = rawPath.trim().split("\t")[0];
  const withoutPrefix = withoutTimestamp.replace(/^[ab]\//, "");

  if (withoutPrefix === "/dev/null") {
    throw new RepairPatchError("Patch previews do not support added or deleted files.");
  }
  if (/^[A-Za-z]:[\\/]/.test(withoutPrefix) || withoutPrefix.startsWith("/") || withoutPrefix.startsWith("\\")) {
    throw new RepairPatchError("Patch paths must be workspace-relative.");
  }

  const segments = withoutPrefix.split(/[\\/]/);
  if (segments.length === 0 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new RepairPatchError("Patch paths must not contain empty, current-directory, or parent-directory segments.");
  }

  return segments.join("/");
}

function rejectUnsupportedMetadata(line: string): void {
  if (
    line.startsWith("Binary files ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ")
  ) {
    throw new RepairPatchError(`Unsupported patch operation: ${line}`);
  }
}

function parseHunkCount(value: string | undefined): number {
  return value === undefined ? 1 : Number(value);
}

function verifyHunkCounts(hunk: UnifiedDiffHunk): void {
  const oldCount = hunk.lines.filter((line) => line.kind !== "add").length;
  const newCount = hunk.lines.filter((line) => line.kind !== "remove").length;
  if (oldCount !== hunk.oldCount || newCount !== hunk.newCount) {
    throw new RepairPatchError("Patch hunk line counts do not match the hunk header.");
  }
}

function getOriginalText(originals: Map<string, string> | Record<string, string>, relativePath: string): string {
  const original = originals instanceof Map ? originals.get(relativePath) : originals[relativePath];
  if (original === undefined) {
    throw new RepairPatchError(`Missing original text for ${relativePath}.`);
  }
  return original;
}

function splitText(text: string): { lines: string[]; eol: string; hasFinalNewline: boolean; hasBom: boolean } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hasFinalNewline = normalized.endsWith("\n");
  const withoutFinalNewline = hasFinalNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split("\n"),
    eol,
    hasFinalNewline,
    hasBom: text.startsWith("\uFEFF")
  };
}

function compareLine(actual: string, expected: string, lineIndex: number): boolean {
  return (lineIndex === 0 ? actual.replace(/^\uFEFF/, "") : actual) === expected;
}
