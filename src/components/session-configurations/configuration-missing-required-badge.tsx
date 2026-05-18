import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { POSAvailableSessionConfiguration } from "@/modules/orders/order.types";

export function ConfigurationMissingRequiredBadge({
  missingRequiredConfigurationCodes,
  availableConfigurations,
}: {
  missingRequiredConfigurationCodes: string[];
  availableConfigurations: POSAvailableSessionConfiguration[];
}) {
  if (missingRequiredConfigurationCodes.length === 0) return null;

  const nameByCode = new Map(
    availableConfigurations.map((configuration) => [
      configuration.code,
      configuration.name,
    ])
  );
  const labels = missingRequiredConfigurationCodes.map(
    (code) => nameByCode.get(code) ?? code
  );

  return (
    <Badge
      variant="outline"
      className="w-fit rounded-md border-warning/30 bg-warning-soft text-warning"
    >
      <AlertTriangle className="mr-1 h-3.5 w-3.5" />
      Required configuration missing: {labels.join(", ")}
    </Badge>
  );
}
