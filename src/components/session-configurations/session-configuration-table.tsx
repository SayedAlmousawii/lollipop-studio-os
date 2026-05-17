import { Check, Minus, MoreHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  SessionConfigurationProductOption,
  SessionConfigurationRow,
  SessionConfigurationSessionTypeOption,
} from "@/modules/session-configurations/session-configuration.types";
import { SessionConfigurationArchiveButton } from "./session-configuration-archive-button";
import { SessionConfigurationEditDialog } from "./session-configuration-edit-dialog";
import { SessionConfigurationStatusBadge } from "./session-configuration-status-badge";

export function SessionConfigurationTable({
  configurations,
  sessionTypes,
  products,
}: {
  configurations: SessionConfigurationRow[];
  sessionTypes: SessionConfigurationSessionTypeOption[];
  products: SessionConfigurationProductOption[];
}) {
  if (configurations.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface px-6 py-10 text-center">
        <p className="text-sm font-medium text-text-primary">
          No session configurations found
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Create the first configuration for an active session type.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Name</TableHead>
            <TableHead className="text-text-secondary">Code</TableHead>
            <TableHead className="text-text-secondary">Session Type</TableHead>
            <TableHead className="text-text-secondary">Input Type</TableHead>
            <TableHead className="text-text-secondary">Pricing Mode</TableHead>
            <TableHead className="text-text-secondary">Financial Behavior</TableHead>
            <TableHead className="text-text-secondary">Required</TableHead>
            <TableHead className="text-text-secondary">Linked Product</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configurations.map((configuration) => (
            <TableRow
              key={configuration.id}
              className="border-border hover:bg-surface-soft"
            >
              <TableCell className="min-w-52 font-medium text-text-primary">
                <div>{configuration.name}</div>
                {configuration.activeOptionCount > 0 ? (
                  <div className="mt-1 text-xs font-normal text-text-secondary">
                    {configuration.optionPreviewLabels.join(", ")}
                    {configuration.activeOptionCount > 3 ? "..." : ""}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-xs text-text-secondary">
                {configuration.code}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {configuration.sessionTypeName}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {labelForEnum(configuration.inputType)}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {labelForEnum(configuration.pricingMode)}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {labelForEnum(configuration.financialBehavior)}
              </TableCell>
              <TableCell>
                {configuration.required ? (
                  <Check className="h-4 w-4 text-success" aria-label="Required" />
                ) : (
                  <Minus className="h-4 w-4 text-text-muted" aria-label="Optional" />
                )}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {configuration.linkedProductName ?? "None"}
              </TableCell>
              <TableCell>
                <SessionConfigurationStatusBadge
                  status={configuration.status}
                />
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "h-8 w-8"
                    )}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Open actions</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <SessionConfigurationEditDialog
                      configuration={configuration}
                      sessionTypes={sessionTypes}
                      products={products}
                    />
                    <SessionConfigurationArchiveButton
                      configurationId={configuration.id}
                      isActive={configuration.isActive}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function labelForEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
