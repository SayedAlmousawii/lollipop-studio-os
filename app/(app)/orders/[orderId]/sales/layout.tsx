import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPOSWorkspace } from "@/modules/orders/order.service";

export default async function SalesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const workspace = await getPOSWorkspace(orderId);
  if (!workspace) notFound();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex-shrink-0 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
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
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary lg:justify-end">
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

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
        {children}
      </div>
    </div>
  );
}
