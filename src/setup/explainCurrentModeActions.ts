import { ExplainModeNextStep, ExplainModeNextStepId, ExplainModeReport } from "./explainCurrentMode";

export interface ExplainModeNextStepAction {
  readonly id: ExplainModeNextStepId;
  readonly label: string;
  readonly detail: string;
  readonly command: string;
  readonly args: readonly string[];
}

const ACTIONS: Record<ExplainModeNextStepId, Omit<ExplainModeNextStepAction, "detail">> = {
  "wait-for-language-server": {
    id: "wait-for-language-server",
    label: "Show language server status",
    command: "isabelle.showLanguageServerStatus",
    args: []
  },
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
  "enable-language-server": {
    id: "enable-language-server",
    label: "Start language server",
    command: "isabelle.startLanguageServer",
    args: []
  },
  "check-prerequisites": {
    id: "check-prerequisites",
    label: "Check setup prerequisites",
    command: "isabelle.checkPrerequisites",
    args: []
  },
  "install-java": {
    id: "install-java",
    label: "Open setup guidance",
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
  nextStep: ExplainModeNextStep
): ExplainModeNextStepAction {
  return {
    ...ACTIONS[nextStep.id],
    detail: nextStep.label
  };
}

export function explainModeActionsForReport(
  report: ExplainModeReport
): readonly ExplainModeNextStepAction[] {
  return report.pideFeatures.nextSteps.map(explainModeActionForNextStep);
}
