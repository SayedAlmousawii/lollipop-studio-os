import Link from "next/link";
import { ArrowLeft, CalendarDays, Camera } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { POSWorkspace } from "@/modules/orders/order.types";

export function SalesWorkspaceHeader({
  workspace,
}: {
  workspace: POSWorkspace;
}) {
  return (
    <header className="flex-shrink-0 border-b border-border px-4 py-3">
      <div className="space-y-3">
        <Button variant="ghost" asChild className="h-auto px-0 py-0">
          <Link href={`/orders/${workspace.orderId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Order
          </Link>
        </Button>

        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-tight text-text-primary">
            {workspace.customerPhone}
          </h1>
          <p className="mt-1 truncate text-sm text-text-secondary">
            {workspace.customerName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <Badge variant="outline" className="rounded-md">
            Job {workspace.jobNumber}
          </Badge>
          <Badge variant="secondary" className="rounded-md">
            {workspace.orderStatus}
          </Badge>
          <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-soft px-2.5 py-1">
            <CalendarDays className="h-4 w-4 text-accent" />
            {workspace.sessionDate}
          </span>
          {workspace.photographerName ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-soft px-2.5 py-1">
              <Camera className="h-4 w-4 text-accent" />
              {workspace.photographerName}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
