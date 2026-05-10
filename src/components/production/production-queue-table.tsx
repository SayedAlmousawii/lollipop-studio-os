import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductionQueueItem } from "@/modules/orders/order.types";

interface ProductionQueueTableProps {
  items: ProductionQueueItem[];
}

export function ProductionQueueTable({ items }: ProductionQueueTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Job Number</TableHead>
            <TableHead className="text-text-secondary">Customer</TableHead>
            <TableHead className="text-text-secondary">Session Date</TableHead>
            <TableHead className="text-text-secondary">Production Status</TableHead>
            <TableHead className="text-text-secondary">Section Summary</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              className="border-border hover:bg-surface-soft"
            >
              <TableCell className="text-sm font-medium text-text-primary">
                <Link href={`/orders/${item.id}`} className="hover:underline">
                  {item.jobNumber}
                </Link>
              </TableCell>
              <TableCell className="font-medium text-text-primary">
                {item.customerName}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {item.sessionDate}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {item.productionStatus}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {item.sectionSummary}
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="h-24 text-center text-sm text-text-secondary"
              >
                No orders are currently in production.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
