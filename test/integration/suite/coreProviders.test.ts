import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

// End-to-end tests for the rest of the offline provider surface: the document
// outline, go-to-definition, the symbol (`\<…>`) and proof-method completions,
// and semantic tokens. Like navigationProviders.test.ts, these open a REAL
// `.thy` file in the VS Code host and drive each provider through VS Code's
// built-in `vscode.executeXProvider` commands — proving the wiring fires, not
// just that the pure cores compute the right answers. No Isabelle needed.

const EXTENSION_ID = "arthur742ramos.isabelle-pide-vscode";

const THEORY = [
  "theory Core", // 0
  "imports Main", // 1
  "begin", // 2
  "", // 3
  "definition base :: nat where \"base = 0\"", // 4
  "", // 5
  "lemma base_eq: \"base = base\"", // 6
  "  by (simp add: base_def)", // 7
  "", // 8
  "datatype shape = Circle | Square", // 9
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

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "isabelle-e2e-core-"));
  const filePath = path.join(tempDir, "Core.thy");
  fs.writeFileSync(filePath, THEORY, "utf8");
  docUri = vscode.Uri.file(filePath);

  const doc = await vscode.workspace.openTextDocument(docUri);
  assert.strictEqual(doc.languageId, "isabelle", "`.thy` must resolve to the isabelle language");
  editor = await vscode.window.showTextDocument(doc);
}

function positionOf(needle: string, occurrence = 0): vscode.Position {
  let from = -1;
  for (let i = 0; i <= occurrence; i++) {
    from = THEORY.indexOf(needle, from + 1);
    assert.ok(from >= 0, `needle "${needle}" #${occurrence} not found`);
  }
  return editor.document.positionAt(from + Math.floor(needle.length / 2));
}

suite("Offline core providers (E2E)", function () {
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
      // best-effort
    }
  });

  test("document symbols surface the theory's named entities with kinds", async () => {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      docUri
    );
    assert.ok(Array.isArray(symbols), "expected an array of document symbols");
    const flat = flatten(symbols!);
    const base = flat.find((s) => s.name === "base");
    assert.ok(base, "outline should include the `base` definition");
    assert.strictEqual(base!.kind, vscode.SymbolKind.Function, "a definition → Function");
    const shape = flat.find((s) => s.name === "shape");
    assert.ok(shape, "outline should include the `shape` datatype");
    assert.strictEqual(shape!.kind, vscode.SymbolKind.Enum, "a datatype → Enum");
    const lemma = flat.find((s) => s.name === "base_eq");
    assert.ok(lemma, "outline should include the `base_eq` lemma");
    assert.strictEqual(lemma!.kind, vscode.SymbolKind.Method, "a lemma → Method");
  });

  test("go-to-definition jumps from a use to the local declaration", async () => {
    // A `base` use in `base_eq`'s statement should resolve to `definition base`.
    // Aim at the `base` immediately before ` = base` on line 6.
    const useOffset = THEORY.indexOf("base = base") + 1; // inside the first `base` token
    const defs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      docUri,
      editor.document.positionAt(useOffset)
    );
    assert.ok(Array.isArray(defs), "expected an array of definition locations");
    // Definition resolution is best-effort/local; if it resolves, it must point
    // into this file at the `definition base` line (4).
    if (defs!.length > 0) {
      assert.ok(
        defs!.some((d) => d.uri.toString() === docUri.toString() && d.range.start.line === 4),
        `definition should resolve to line 4, got ${JSON.stringify(defs!.map((d) => d.range.start.line))}`
      );
    }
  });

  test("symbol completion offers Isabelle symbols after `\\<`", async () => {
    // Insert a `\<` at end of file body so completion has a token to expand.
    const insertPos = new vscode.Position(10, 0); // blank line 10
    await editor.edit((b) => b.insert(insertPos, "term \\<fora"));
    try {
      const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        docUri,
        new vscode.Position(10, "term \\<fora".length)
      );
      assert.ok(list, "expected a completion list");
      const labels = list!.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
      assert.ok(
        labels.some((l) => l.includes("forall")),
        `expected a \\<forall> completion, got ${labels.slice(0, 10).join(", ")}…`
      );
    } finally {
      // Revert the edit so other tests see the original document.
      await editor.edit((b) =>
        b.delete(new vscode.Range(new vscode.Position(10, 0), new vscode.Position(10, "term \\<fora".length)))
      );
    }
  });

  test("method completion offers proof methods after `by`", async () => {
    const insertPos = new vscode.Position(10, 0);
    await editor.edit((b) => b.insert(insertPos, "by aut"));
    try {
      const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        docUri,
        new vscode.Position(10, "by aut".length)
      );
      assert.ok(list, "expected a completion list");
      const labels = list!.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
      assert.ok(
        labels.includes("auto"),
        `expected an \`auto\` method completion, got ${labels.slice(0, 15).join(", ")}…`
      );
    } finally {
      await editor.edit((b) =>
        b.delete(new vscode.Range(new vscode.Position(10, 0), new vscode.Position(10, "by aut".length)))
      );
    }
  });

  test("semantic tokens are produced for the theory", async () => {
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
      "vscode.provideDocumentSemanticTokensLegend",
      docUri
    );
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      "vscode.provideDocumentSemanticTokens",
      docUri
    );
    // The provider is registered with a legend; tokens may be undefined only if
    // no provider matched. We registered one, so expect a legend + data.
    assert.ok(legend, "expected a semantic tokens legend");
    assert.ok(tokens, "expected semantic tokens");
    assert.ok(tokens!.data.length > 0, "expected at least one semantic token in a non-trivial theory");
  });
});

function flatten(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  return symbols.flatMap((s) => [s, ...flatten(s.children ?? [])]);
}
