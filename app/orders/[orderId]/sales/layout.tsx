import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Phone } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
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
    <PageContainer>
      <div className="space-y-5">
        <Button variant="ghost" asChild className="px-0">
          <Link href={`/orders/${workspace.orderId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Order
          </Link>
        </Button>

        <header className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-md">
                  Job {workspace.jobNumber}
                </Badge>
                <Badge variant="secondary" className="rounded-md">
                  {workspace.orderStatus}
                </Badge>
              </div>
              <div>
                <h1 className="text-[28px] font-semibold text-text-primary">
                  Sales Workspace
                </h1>
                <p className="mt-1 text-sm text-text-secondary">
                  {workspace.customerName}
                </p>
              </div>
            </div>
            <div className="grid gap-2 text-sm text-text-secondary sm:text-right">
              <span className="inline-flex items-center gap-2 sm:justify-end">
                <CalendarDays className="h-4 w-4 text-accent" />
                {workspace.sessionDate}
              </span>
              <span className="inline-flex items-center gap-2 sm:justify-end">
                <Phone className="h-4 w-4 text-accent" />
                {workspace.customerPhone}
              </span>
            </div>
          </div>
        </header>

        {children}
      </div>
    </PageContainer>
  );
}
