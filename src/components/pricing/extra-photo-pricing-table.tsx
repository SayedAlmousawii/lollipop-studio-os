import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExtraPhotoPricingRow } from "@/modules/pricing/pricing.types";

interface ExtraPhotoPricingTableProps {
  rows: ExtraPhotoPricingRow[];
}

interface SessionTypeGroup {
  departmentName: string;
  sessionTypeName: string;
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
            <TableHead className="text-text-secondary">Media Type</TableHead>
            <TableHead className="text-text-secondary">Unit Price</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) =>
            group.rows.map((row, index) => (
              <TableRow
                key={row.id}
                className="border-border hover:bg-surface-soft"
              >
                {index === 0 ? (
                  <>
                    <TableCell
                      rowSpan={group.rows.length}
                      className="align-top font-medium text-text-primary"
                    >
                      {group.departmentName}
                    </TableCell>
                    <TableCell
                      rowSpan={group.rows.length}
                      className="align-top text-sm text-text-secondary"
                    >
                      {group.sessionTypeName}
                    </TableCell>
                  </>
                ) : null}
                <TableCell className="text-sm text-text-secondary">
                  {row.mediaTypeLabel}
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  {row.unitPrice}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function groupRows(rows: ExtraPhotoPricingRow[]): SessionTypeGroup[] {
  const groups: SessionTypeGroup[] = [];
  const groupByKey = new Map<string, SessionTypeGroup>();

  for (const row of rows) {
    const key = row.sessionTypeId;
    const existingGroup = groupByKey.get(key);
    if (existingGroup) {
      existingGroup.rows.push(row);
      continue;
    }

    const group = {
      departmentName: row.departmentName,
      sessionTypeName: row.sessionTypeName,
      rows: [row],
    };
    groupByKey.set(key, group);
    groups.push(group);
  }

  return groups;
}
