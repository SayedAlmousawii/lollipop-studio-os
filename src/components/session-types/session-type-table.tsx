import { MoreHorizontal } from "lucide-react";
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
  SessionTypeDepartmentOption,
  SessionTypeRow,
} from "@/modules/session-types/session-type.types";
import { calendarColorSwatchClass } from "./session-type-calendar-colors";
import { SessionTypeArchiveButton } from "./session-type-archive-button";
import { SessionTypeEditDialog } from "./session-type-edit-dialog";
import { SessionTypeStatusBadge } from "./session-type-status-badge";

interface SessionTypeTableProps {
  sessionTypes: SessionTypeRow[];
  departments: SessionTypeDepartmentOption[];
}

type SessionTypeGroup = {
  departmentId: string;
  departmentName: string;
  rows: SessionTypeRow[];
};

export function SessionTypeTable({
  sessionTypes,
  departments,
}: SessionTypeTableProps) {
  if (sessionTypes.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface px-6 py-10 text-center">
        <p className="text-sm font-medium text-text-primary">
          No session types found
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Create the first session type for an active department.
        </p>
      </div>
    );
  }

  const groups = groupSessionTypes(sessionTypes);

  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Department</TableHead>
            <TableHead className="text-text-secondary">Name</TableHead>
            <TableHead className="text-text-secondary">Code</TableHead>
            <TableHead className="text-text-secondary">Calendar</TableHead>
            <TableHead className="text-text-secondary">Pricing</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) =>
            group.rows.map((sessionType, index) => (
              <TableRow
                key={sessionType.id}
                className="border-border hover:bg-surface-soft"
              >
                {index === 0 ? (
                  <TableCell
                    rowSpan={group.rows.length}
                    className="align-top font-medium text-text-primary"
                  >
                    {group.departmentName}
                  </TableCell>
                ) : null}
                <TableCell className="font-medium text-text-primary">
                  {sessionType.name}
                </TableCell>
                <TableCell className="font-mono text-xs text-text-secondary">
                  {sessionType.code}
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-3 w-3 rounded-full border border-border",
                        calendarColorSwatchClass(sessionType.calendarColor)
                      )}
                      aria-hidden="true"
                    />
                    <span>{sessionType.calendarLabel}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {sessionType.pricingConfigured ? (
                    "Configured"
                  ) : (
                    <span className="text-warning">
                      0 KD {sessionType.zeroPriceMediaTypes.join(" / ")}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <SessionTypeStatusBadge status={sessionType.status} />
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
                    <DropdownMenuContent align="end" className="w-52">
                      <SessionTypeEditDialog
                        sessionType={sessionType}
                        departments={departments}
                      />
                      <SessionTypeArchiveButton
                        sessionTypeId={sessionType.id}
                        isActive={sessionType.isActive}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function groupSessionTypes(sessionTypes: SessionTypeRow[]): SessionTypeGroup[] {
  const groups: SessionTypeGroup[] = [];
  const groupsByDepartment = new Map<string, SessionTypeGroup>();

  for (const sessionType of sessionTypes) {
    const existing = groupsByDepartment.get(sessionType.departmentId);
    if (existing) {
      existing.rows.push(sessionType);
      continue;
    }

    const group = {
      departmentId: sessionType.departmentId,
      departmentName: sessionType.departmentName,
      rows: [sessionType],
    };
    groupsByDepartment.set(sessionType.departmentId, group);
    groups.push(group);
  }

  return groups;
}
