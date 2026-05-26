import { ExplainModeNextStep, ExplainModeNextStepId, ExplainModeReport } from "./explainCurrentMode";

export interface ExplainModeNextStepAction {
  readonly id: ExplainModeNextStepId;
  readonly label: string;
  readonly detail: string;
  readonly command: string;
  readonly args: readonly unknown[];
}

export interface ExplainModeActionOptions {
  readonly setupWalkthroughId?: string;
}

const ACTIONS: Record<
  Exclude<ExplainModeNextStepId, "install-java" | "wait-for-language-server">,
  Omit<ExplainModeNextStepAction, "detail">
> = {
  "show-language-server-status": {
    id: "show-language-server-status",
    label: "Show language server status",
    command: "isabelle.showLanguageServerStatus",
    args: []
  },
  "restart-language-server": {
    id: "restart-language-server",
    label: "Restart language server",
    command: "isabelle.restartLanguageServer",
    args: []
  },
  "retry-language-server-auto-start": {
    id: "retry-language-server-auto-start",
    label: "Retry language server auto-start",
    command: "isabelle.retryLanguageServerAutoStart",
    args: []
  },
  "enable-language-server": {
    id: "enable-language-server",
    label: "Open language server setting",
    command: "workbench.action.openSettings",
    args: ["isabelle.languageServer.enabled"]
  },
  "enable-language-server-auto-start": {
    id: "enable-language-server-auto-start",
    label: "Open auto-start setting",
    command: "workbench.action.openSettings",
    args: ["isabelle.languageServer.autoStart"]
  },
  "check-prerequisites": {
    id: "check-prerequisites",
    label: "Check setup prerequisites",
    command: "isabelle.checkPrerequisites",
    args: []
  },
  "set-isabelle-executable": {
    id: "set-isabelle-executable",
    label: "Open Isabelle executable setting",
    command: "workbench.action.openSettings",
    args: ["isabelle.executablePath"]
  },
  "start-language-server": {
    id: "start-language-server",
    label: "Start language server",
    command: "isabelle.startLanguageServer",
    args: []
  },
  "wait-for-prerequisite-probe": {
    id: "wait-for-prerequisite-probe",
    label: "Check setup prerequisites",
    command: "isabelle.checkPrerequisites",
    args: []
  }
};

export function explainModeActionForNextStep(
  nextStep: ExplainModeNextStep,
  options: ExplainModeActionOptions = {}
): ExplainModeNextStepAction | undefined {
  if (nextStep.id === "wait-for-language-server") {
    return undefined;
  }
  if (nextStep.id === "install-java") {
    return {
      id: nextStep.id,
      label: options.setupWalkthroughId ? "Open setup walkthrough" : "Check setup prerequisites",
      detail: nextStep.label,
      command: options.setupWalkthroughId
        ? "workbench.action.openWalkthrough"
        : "isabelle.checkPrerequisites",
      args: options.setupWalkthroughId ? [options.setupWalkthroughId, false] : []
    };
  }
  return {
    ...ACTIONS[nextStep.id],
    detail: nextStep.label
  };
}

export function explainModeActionsForReport(
  report: ExplainModeReport,
  options: ExplainModeActionOptions = {}
): readonly ExplainModeNextStepAction[] {
  const seen = new Set<string>();
  const actions: ExplainModeNextStepAction[] = [];
  for (const nextStep of report.pideFeatures.nextSteps) {
    const action = explainModeActionForNextStep(nextStep, options);
    if (!action) {
      continue;
    }
    const key = `${action.command}\u0000${JSON.stringify(action.args)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    actions.push(action);
  }
  return actions;
}
