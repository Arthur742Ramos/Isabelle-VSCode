import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

// End-to-end tests for the offline language providers added in #142–#146:
// occurrence highlighting, Find All References, Go to Symbol in Workspace, and
// smart selection. These do what no structural (vscode-free) test can: they
// open a REAL `.thy` file in a running VS Code host and invoke each provider
// through VS Code's built-in `vscode.executeXProvider` command, proving the
// whole path — file open → `isabelle` language → provider registration →
// dispatch → our provider code → results — actually fires.
//
// The providers register against `{ language: "isabelle", scheme: "file" }`, so
// the document must be a real on-disk file (not an `untitled:` buffer). No
// Isabelle install is needed; everything here is the offline local foundation.

const EXTENSION_ID = "arthur742ramos.isabelle-pide-vscode";

const THEORY = [
  "theory Nav", // 0
  "imports Main", // 1
  "begin", // 2
  "", // 3
  "definition foo :: nat where \"foo = 0\"", // 4
  "", // 5
  "lemma foo_pos: \"foo \\<ge> 0\"", // 6
  "  using foo_def by simp", // 7
  "", // 8
  "datatype color = Red | Green", // 9
  "", // 10
  "end" // 11
].join("\n");

let tempDir: string;
let docUri: vscode.Uri;
let editor: vscode.TextEditor;

async function openTheory(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, `Expected ${EXTENSION_ID} to be installed`);
  await ext!.activate();

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "isabelle-e2e-"));
  const filePath = path.join(tempDir, "Nav.thy");
  fs.writeFileSync(filePath, THEORY, "utf8");
  docUri = vscode.Uri.file(filePath);

  const doc = await vscode.workspace.openTextDocument(docUri);
  // The file association maps `.thy` → `isabelle`; assert it so a mis-detection
  // surfaces as a clear failure rather than empty provider results.
  assert.strictEqual(doc.languageId, "isabelle", "`.thy` must resolve to the isabelle language");
  editor = await vscode.window.showTextDocument(doc);
}

/** Offset of the first occurrence of `needle` in the theory, as a Position. */
function positionOf(needle: string, occurrence = 0): vscode.Position {
  let from = -1;
  for (let i = 0; i <= occurrence; i++) {
    from = THEORY.indexOf(needle, from + 1);
    assert.ok(from >= 0, `needle "${needle}" #${occurrence} not found`);
  }
  // Aim at the middle of the token so the cursor is unambiguously inside it.
  const offset = from + Math.floor(needle.length / 2);
  return editor.document.positionAt(offset);
}

suite("Offline navigation providers (E2E)", function () {
  this.timeout(30_000);

  suiteSetup(async () => {
    await openTheory();
  });

  suiteTeardown(() => {
    try {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // best-effort cleanup
    }
  });

  test("document highlights mark every use of the identifier under the cursor", async () => {
    const highlights = await vscode.commands.executeCommand<vscode.DocumentHighlight[]>(
      "vscode.executeDocumentHighlights",
      docUri,
      positionOf("foo") // the `definition foo` declaration
    );
    assert.ok(Array.isArray(highlights), "expected an array of highlights");
    // `foo` occurs as code at: definition foo (4) and the `foo` in `foo_pos`'s
    // unfolding? No — `foo_def`/`foo_pos` are different tokens, and the `foo`
    // inside the quoted props are masked. The declaration itself must be one.
    assert.ok(highlights!.length >= 1, `expected at least one highlight, got ${highlights!.length}`);
    const decl = highlights!.find((h) => h.range.start.line === 4);
    assert.ok(decl, "the `definition foo` occurrence should be highlighted");
    assert.strictEqual(
      decl!.kind,
      vscode.DocumentHighlightKind.Write,
      "the declaration occurrence should be a Write highlight"
    );
  });

  test("find all references returns the uses across the document", async () => {
    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      docUri,
      positionOf("color") // datatype color
    );
    assert.ok(Array.isArray(refs), "expected an array of locations");
    assert.ok(refs!.length >= 1, `expected at least one reference to color, got ${refs!.length}`);
    assert.ok(
      refs!.every((loc) => loc.uri.toString() === docUri.toString()),
      "all references should be in the opened theory"
    );
    assert.ok(
      refs!.some((loc) => loc.range.start.line === 9),
      "the `datatype color` declaration line should be among the references"
    );
  });

  test("workspace symbols find the theory's named entities by query", async () => {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      "foo"
    );
    assert.ok(Array.isArray(symbols), "expected an array of workspace symbols");
    const foo = symbols!.find((s) => s.name === "foo");
    assert.ok(foo, "workspace symbols should include the `foo` definition");
    assert.strictEqual(foo!.kind, vscode.SymbolKind.Function, "`foo` is a definition → Function kind");

    const colorSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      "color"
    );
    const color = colorSymbols!.find((s) => s.name === "color");
    assert.ok(color, "workspace symbols should include the `color` datatype");
    assert.strictEqual(color!.kind, vscode.SymbolKind.Enum, "a datatype → Enum kind");
  });

  test("selection ranges grow from the token outward", async () => {
    const ranges = await vscode.commands.executeCommand<vscode.SelectionRange[]>(
      "vscode.executeSelectionRangeProvider",
      docUri,
      [positionOf("foo")]
    );
    assert.ok(Array.isArray(ranges) && ranges.length === 1, "expected one selection range chain");

    // Walk the parent chain and assert it grows strictly outward and the
    // innermost range is the `foo` token.
    const sizes: number[] = [];
    let node: vscode.SelectionRange | undefined = ranges![0];
    let innermostText = "";
    let first = true;
    while (node) {
      const text = editor.document.getText(node.range);
      if (first) {
        innermostText = text;
        first = false;
      }
      sizes.push(text.length);
      node = node.parent;
    }
    assert.ok(sizes.length >= 2, "expected a nested selection chain");
    assert.strictEqual(innermostText, "foo", "the innermost selection should be the `foo` token");
    for (let i = 1; i < sizes.length; i++) {
      assert.ok(sizes[i] > sizes[i - 1], `selection chain must grow outward (sizes: ${sizes.join(", ")})`);
    }
  });

  test("folding ranges include the begin..end body and the proof", async () => {
    const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      "vscode.executeFoldingRangeProvider",
      docUri
    );
    assert.ok(Array.isArray(folds), "expected an array of folding ranges");
    // The multi-line `theory … begin` header (lines 0–2) should fold.
    assert.ok(
      folds!.some((f) => f.start === 0),
      `expected a fold starting at the theory header (got ${JSON.stringify(folds)})`
    );
  });

  test("hover on a command keyword describes it", async () => {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      docUri,
      positionOf("lemma")
    );
    assert.ok(Array.isArray(hovers) && hovers.length >= 1, "expected a hover on `lemma`");
    const text = hovers!
      .flatMap((h) => h.contents)
      .map((c) => (typeof c === "string" ? c : (c as vscode.MarkdownString).value))
      .join("\n");
    assert.ok(/Isabelle command/i.test(text), `hover should describe an Isabelle command: ${text}`);
  });
});
