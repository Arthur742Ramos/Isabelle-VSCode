import * as vscode from "vscode";
import { DocumentSyncService } from "../document/DocumentSyncService";
import { CommandSpan } from "../protocol/messages";
import {
  extractTheoryEntities,
  groupEntitiesByKind,
  IsabelleEntityKind,
  IsabelleTheoryEntity,
  THEORY_ENTITY_KINDS
} from "./theoryEntities";

type TheoryOutlineNode =
  | { kind: "placeholder"; label: string; description?: string }
  | {
      kind: "group";
      entityKind: IsabelleEntityKind;
      entries: TheoryOutlineEntry[];
      uri: string;
    }
  | {
      kind: "entity";
      entry: TheoryOutlineEntry;
      uri: string;
    };

interface TheoryOutlineEntry {
  entity: IsabelleTheoryEntity;
  span: CommandSpan;
}

const KIND_LABELS: Record<IsabelleEntityKind, string> = {
  theorem: "Theorems",
  lemma: "Lemmas",
  corollary: "Corollaries",
  proposition: "Propositions",
  schematic_goal: "Schematic Goals",
  definition: "Definitions",
  abbreviation: "Abbreviations",
  fun: "Functions (fun)",
  function: "Functions",
  primrec: "Primitive Recursive Functions",
  primcorec: "Primitive Corecursive Functions",
  inductive: "Inductive Predicates",
  inductive_set: "Inductive Sets",
  coinductive: "Coinductive Predicates",
  datatype: "Datatypes",
  codatatype: "Codatatypes",
  record: "Records",
  typedef: "Type Definitions",
  typedecl: "Type Declarations",
  type_synonym: "Type Synonyms",
  lift_definition: "Lifted Definitions",
  locale: "Locales",
  class: "Type Classes",
  section: "Sections",
  subsection: "Subsections",
  subsubsection: "Subsubsections",
  theory: "Theories"
};

export class TheoryOutlineTreeProvider
  implements vscode.TreeDataProvider<TheoryOutlineNode>, vscode.Disposable
{
  private readonly didChangeTreeData = new vscode.EventEmitter<TheoryOutlineNode | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  public readonly onDidChangeTreeData = this.didChangeTreeData.event;

  public constructor(private readonly documents: DocumentSyncService) {
    this.disposables.push(
      this.documents.onDidChangeTheoryDocument((result) => {
        const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (activeUri && activeUri === result.uri) {
          this.scheduleRefresh();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isTheoryDocument(event.document)) {
          this.scheduleRefresh();
        }
      })
    );
  }

  public refresh(): void {
    this.didChangeTreeData.fire(undefined);
  }

  public getTreeItem(element: TheoryOutlineNode): vscode.TreeItem {
    if (element.kind === "placeholder") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    if (element.kind === "group") {
      const label = KIND_LABELS[element.entityKind] ?? element.entityKind;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${element.entries.length}`;
      item.iconPath = iconForKind(element.entityKind);
      item.contextValue = "isabelleTheoryEntityGroup";
      return item;
    }

    const { entity, span } = element.entry;
    const item = new vscode.TreeItem(entity.name, vscode.TreeItemCollapsibleState.None);
    item.description = entity.kind;
    item.tooltip = [
      `${entity.kind} ${entity.name}`,
      `Range: ${entity.range.start.line + 1}:${entity.range.start.character + 1}`,
      "Source: local syntax extraction (no PIDE entity metadata)"
    ].join("\n");
    item.iconPath = iconForKind(entity.kind);
    item.contextValue = "isabelleTheoryEntity";
    item.command = {
      command: "isabelle.revealCommandSpan",
      title: "Reveal Isabelle Command",
      arguments: [element.uri, span]
    };
    return item;
  }

  public getChildren(element?: TheoryOutlineNode): TheoryOutlineNode[] {
    if (element?.kind === "group") {
      return element.entries.map((entry) => ({
        kind: "entity",
        entry,
        uri: element.uri
      }));
    }

    if (element) {
      return [];
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document)) {
      return [this.placeholder("No Isabelle theory entities for the active editor.")];
    }

    const spans = this.documents.getCommandSpans(editor.document);
    const entities = extractTheoryEntities(spans);
    if (entities.length === 0) {
      return [this.placeholder("No Isabelle theory entities for the active editor.")];
    }

    const spanById = new Map(spans.map((span) => [span.id, span]));
    const grouped = groupEntitiesByKind(entities);
    const uri = editor.document.uri.toString();

    const nodes: TheoryOutlineNode[] = [];
    for (const kind of THEORY_ENTITY_KINDS) {
      const groupEntities = grouped[kind];
      if (groupEntities.length === 0) {
        continue;
      }

      const entries: TheoryOutlineEntry[] = [];
      for (const entity of groupEntities) {
        const span = spanById.get(entity.spanId);
        if (span) {
          entries.push({ entity, span });
        }
      }

      if (entries.length === 0) {
        continue;
      }

      nodes.push({ kind: "group", entityKind: kind, entries, uri });
    }

    if (nodes.length === 0) {
      return [this.placeholder("No Isabelle theory entities for the active editor.")];
    }

    return nodes;
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.didChangeTreeData.dispose();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, 150);
  }

  private placeholder(label: string): TheoryOutlineNode {
    return {
      kind: "placeholder",
      label,
      description: "Local syntax extraction; PIDE entity metadata is not yet integrated."
    };
  }
}

function iconForKind(kind: IsabelleEntityKind): vscode.ThemeIcon {
  switch (kind) {
    case "theorem":
    case "lemma":
    case "corollary":
    case "proposition":
    case "schematic_goal":
      return new vscode.ThemeIcon("symbol-method");
    case "definition":
    case "abbreviation":
    case "fun":
    case "function":
    case "primrec":
    case "primcorec":
    case "inductive":
    case "inductive_set":
    case "coinductive":
    case "lift_definition":
      return new vscode.ThemeIcon("symbol-function");
    case "datatype":
    case "codatatype":
    case "record":
    case "locale":
    case "class":
      return new vscode.ThemeIcon("symbol-class");
    case "typedef":
    case "typedecl":
    case "type_synonym":
      return new vscode.ThemeIcon("symbol-interface");
    case "section":
    case "subsection":
    case "subsubsection":
      return new vscode.ThemeIcon("symbol-namespace");
    case "theory":
      return new vscode.ThemeIcon("symbol-module");
    default:
      return new vscode.ThemeIcon("symbol-keyword");
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
