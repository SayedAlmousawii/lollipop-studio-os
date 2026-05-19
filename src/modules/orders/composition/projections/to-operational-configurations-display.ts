import type { POSWorkspace } from "@/modules/orders/order.types";

export type OperationalConfigurationsPackageLine = {
  packageName: string;
  sessionTypeName: string;
  operationalSelections: {
    configName: string;
    valueDisplay: string;
  }[];
};

type OperationalConfigurationSelection =
  POSWorkspace["packageLines"][number]["sessionConfigurationSummary"][number];

export function toOperationalConfigurationsDisplay(
  workspace: POSWorkspace | null
): OperationalConfigurationsPackageLine[] {
  if (!workspace) return [];

  return workspace.packageLines.map((line) => ({
    packageName: line.currentPackage.name,
    sessionTypeName: line.sessionTypeName,
    operationalSelections: line.sessionConfigurationSummary
      .filter((selection) => selection.financialBehavior === "OPERATIONAL")
      .map((selection) => ({
        configName: selection.label,
        valueDisplay: valueDisplayForOperationalSelection(selection),
      }))
      .filter((selection) => selection.valueDisplay.trim().length > 0),
  }));
}

function valueDisplayForOperationalSelection(
  selection: OperationalConfigurationSelection
): string {
  switch (selection.inputType) {
    case "TOGGLE":
      return "Enabled";
    case "SELECT":
      return selection.optionLabel ?? "";
    case "NUMBER":
    case "COUNTER":
      return selection.numericValue ?? "";
    case "TEXT":
      return selection.textValue ?? "";
  }
}
