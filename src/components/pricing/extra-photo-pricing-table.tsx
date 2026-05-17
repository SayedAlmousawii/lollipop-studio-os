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
import type { ExtraPhotoPricingRow } from "@/modules/pricing/pricing.types";
import { ExtraPhotoPricingEditDialog } from "./extra-photo-pricing-edit-dialog";

interface ExtraPhotoPricingTableProps {
  rows: ExtraPhotoPricingRow[];
}

interface DepartmentGroup {
  departmentCode: string;
  departmentName: string;
  rows: ExtraPhotoPricingRow[];
}

export function ExtraPhotoPricingTable({ rows }: ExtraPhotoPricingTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface px-6 py-10 text-center">
        <p className="text-sm font-medium text-text-primary">
          No extra-photo prices found
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Seed the pricing catalog to review session-type prices.
        </p>
      </div>
    );
  }

  const groups = groupRows(rows);

  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Department</TableHead>
            <TableHead className="text-text-secondary">Session Type</TableHead>
            <TableHead className="text-text-secondary">Digital unit price</TableHead>
            <TableHead className="text-text-secondary">Print unit price</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) =>
            group.rows.map((row, index) => (
              <TableRow
                key={row.sessionTypeId}
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
                  <div>{row.sessionTypeName}</div>
                  <p className="mt-1 font-mono text-xs font-normal text-text-secondary">
                    {row.sessionTypeCode}
                  </p>
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {row.digitalUnitPrice}
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {row.printUnitPrice}
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
                    <DropdownMenuContent align="end" className="w-48">
                      <ExtraPhotoPricingEditDialog row={row} />
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

function groupRows(rows: ExtraPhotoPricingRow[]): DepartmentGroup[] {
  const groups: DepartmentGroup[] = [];
  const groupByKey = new Map<string, DepartmentGroup>();

  for (const row of rows) {
    const key = row.departmentCode;
    const existingGroup = groupByKey.get(key);
    if (existingGroup) {
      existingGroup.rows.push(row);
      continue;
    }

    const group = {
      departmentCode: row.departmentCode,
      departmentName: row.departmentName,
      rows: [row],
    };
    groupByKey.set(key, group);
    groups.push(group);
  }

  return groups;
}
