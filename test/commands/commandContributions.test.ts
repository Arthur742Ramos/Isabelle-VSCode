import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = resolve(__dirname, "..", "..", "package.json");

interface CommandContribution {
  command: string;
  title: string;
  category?: string;
}

interface MenuContribution {
  command: string;
  when?: string;
}

interface ViewContribution {
  id: string;
  name: string;
}

interface ViewsWelcomeContribution {
  view: string;
  contents: string;
}

interface PackageJson {
  activationEvents?: string[];
  contributes?: {
    commands?: CommandContribution[];
    menus?: {
      commandPalette?: MenuContribution[];
    };
    views?: Record<string, ViewContribution[]>;
    viewsWelcome?: ViewsWelcomeContribution[];
  };
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
const commands = packageJson.contributes?.commands ?? [];
const commandIds = new Set(commands.map((entry) => entry.command));
const activationEvents = new Set(packageJson.activationEvents ?? []);
const commandPalette = packageJson.contributes?.menus?.commandPalette ?? [];
const contributedViews = Object.values(packageJson.contributes?.views ?? {}).flat();
const viewsWelcome = packageJson.contributes?.viewsWelcome ?? [];

const GLOBAL_SETUP_AND_DIAGNOSTIC_COMMANDS = [
  "isabelle.showVersion",
  "isabelle.checkBackendHealth",
  "isabelle.showPideBackendStatus",
  "isabelle.showPideDocumentStatus",
  "isabelle.invalidatePideCache",
  "isabelle.startLanguageServer",
  "isabelle.stopLanguageServer",
  "isabelle.restartLanguageServer",
  "isabelle.showLanguageServerStatus",
  "isabelle.checkPrerequisites",
  "isabelle.explainCurrentMode"
];

describe("command contribution manifest", () => {
  it("keeps every contributed command in the Isabelle namespace with a consistent title/category shape", () => {
    expect(commands.length).toBeGreaterThan(0);

    for (const command of commands) {
      expect(command.command, `${command.command} should be namespaced`).toMatch(/^isabelle\./);
      expect(command.title, `${command.command} should use the command palette prefix`).toMatch(/^Isabelle: /);
      if (command.category !== undefined) {
        expect(command.category, `${command.command} category`).toBe("Isabelle");
      }
    }
  });

  it("adds an activation event for every contributed command", () => {
    for (const command of commands) {
      expect(
        activationEvents.has(`onCommand:${command.command}`),
        `${command.command} is missing an activationEvents entry`
      ).toBe(true);
    }
  });

  it("only references contributed commands from command palette visibility rules", () => {
    for (const entry of commandPalette) {
      expect(
        commandIds.has(entry.command),
        `commandPalette entry references unknown command "${entry.command}"`
      ).toBe(true);
      expect(typeof entry.when, `${entry.command} commandPalette entry should be contextual`).toBe("string");
    }
  });

  it("keeps fresh-install setup and diagnostic commands globally discoverable", () => {
    const contextualPaletteCommands = new Set(commandPalette.map((entry) => entry.command));

    for (const command of GLOBAL_SETUP_AND_DIAGNOSTIC_COMMANDS) {
      expect(commandIds.has(command), `${command} should still be contributed`).toBe(true);
      expect(
        contextualPaletteCommands.has(command),
        `${command} should not be hidden behind editor or panel context`
      ).toBe(false);
    }
  });
});

describe("viewsWelcome contribution manifest", () => {
  it("provides welcome content for every contributed Isabelle view", () => {
    expect(contributedViews.length).toBeGreaterThan(0);
    const welcomeByView = new Map(viewsWelcome.map((entry) => [entry.view, entry.contents]));

    for (const view of contributedViews) {
      expect(welcomeByView.get(view.id), `${view.id} should have viewsWelcome content`).toBeTruthy();
    }
  });

  it("only links to commands contributed by the extension", () => {
    const commandLinkPattern = /\(command:([^)]+)\)/g;

    for (const welcome of viewsWelcome) {
      for (const match of welcome.contents.matchAll(commandLinkPattern)) {
        expect(
          commandIds.has(match[1]),
          `${welcome.view} links to unknown command "${match[1]}"`
        ).toBe(true);
      }
    }
  });
});
