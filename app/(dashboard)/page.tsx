import Link from "next/link";
import { ArrowRight, Camera, ClipboardList, DollarSign, Search, Users } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { StatCard } from "@/components/dashboard/stat-card";
import { SectionHeader } from "@/components/dashboard/section-header";
import { ScheduleItem } from "@/components/dashboard/schedule-item";
import { ActivityItem } from "@/components/dashboard/activity-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvoiceStatusBadge } from "@/components/orders/invoice-status-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { getDashboardData } from "@/modules/dashboard/dashboard.service";
import { getCustomerByPhone, type CustomerPhoneLookup } from "@/modules/customers/customer.service";
import { getOrdersByCustomerId } from "@/modules/orders/order.service";
import type { CustomerOrderHistoryItem } from "@/modules/orders/order.types";

export default async function DashboardPage(props: PageProps<"/">) {
  const searchParams = await props.searchParams;
  const phoneSearch = singleValue(searchParams.phone)?.trim() ?? "";
  const [dashboardData, phoneLookup] = await Promise.all([
    getDashboardData(),
    getPhoneLookup(phoneSearch),
  ]);
  const { stats, todaySchedule, recentActivity } = dashboardData;

  return (
    <PageContainer>
      <div className="space-y-8">
        <section>
          <SectionHeader title="Overview" description="Today's at-a-glance summary" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Today's Sessions"
              value={String(stats.todaySessionCount)}
              subtext={`${stats.todayConfirmed} confirmed · ${stats.todayPending} pending`}
              icon={<Camera size={18} />}
            />
            <StatCard
              title="Revenue Today"
              value={`KD ${stats.revenueToday.toLocaleString()}`}
              subtext="Payments received today"
              icon={<DollarSign size={18} />}
            />
            <StatCard
              title="Pending Tasks"
              value={String(stats.pendingTasks)}
              subtext="Awaiting selection, editing, or ready"
              icon={<ClipboardList size={18} />}
            />
            <StatCard
              title="New Customers"
              value={String(stats.newCustomersThisWeek)}
              subtext="This week"
              icon={<Users size={18} />}
            />
          </div>
        </section>

        <PhoneSalesSearch
          phoneSearch={phoneSearch}
          customer={phoneLookup.customer}
          orders={phoneLookup.orders}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-[14px] border border-border bg-surface p-5">
            <SectionHeader title="Today's Schedule" description="Upcoming sessions and bookings" />
            <div className="mt-4">
              {todaySchedule.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions scheduled for today.</p>
              ) : (
                todaySchedule.map(({ id, ...item }) => (
                  <ScheduleItem key={id} {...item} />
                ))
              )}
            </div>
          </section>

          <section className="rounded-[14px] border border-border bg-surface p-5">
            <SectionHeader title="Recent Activity" description="Latest workflow updates" />
            <div className="mt-4">
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              ) : (
                recentActivity.map(({ id, ...item }) => (
                  <ActivityItem key={id} {...item} />
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}

async function getPhoneLookup(phoneSearch: string): Promise<{
  customer: CustomerPhoneLookup | null;
  orders: CustomerOrderHistoryItem[];
}> {
  if (!phoneSearch) {
    return { customer: null, orders: [] };
  }

  const customer = await getCustomerByPhone(phoneSearch);

  if (!customer) {
    return { customer: null, orders: [] };
  }

  const orders = await getOrdersByCustomerId(customer.id);

  return { customer, orders };
}

function PhoneSalesSearch({
  phoneSearch,
  customer,
  orders,
}: {
  phoneSearch: string;
  customer: CustomerPhoneLookup | null;
  orders: CustomerOrderHistoryItem[];
}) {
  const hasSearched = phoneSearch.length > 0;

  return (
    <section className="rounded-[14px] border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          title="Sales Lookup"
          description="Find a customer by phone and open their POS workspace directly."
        />
        <form action="/" className="flex w-full gap-2 lg:max-w-md">
          <label htmlFor="dashboard-phone-search" className="sr-only">
            Search by phone number
          </label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
            <Input
              id="dashboard-phone-search"
              name="phone"
              type="search"
              inputMode="tel"
              placeholder="Search phone number..."
              defaultValue={phoneSearch}
              className="pl-9"
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
      </div>

      <div className="mt-5">
        {!hasSearched ? (
          <p className="rounded-[12px] border border-dashed border-border bg-surface-soft p-4 text-sm text-text-secondary">
            Enter a phone number to see recent orders and jump into the sales workspace.
          </p>
        ) : customer ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-1 rounded-[12px] bg-surface-soft p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {customer.fullName}
                </p>
                <p className="text-sm tabular-nums text-text-secondary">
                  {customer.phone}
                </p>
              </div>
              <p className="text-xs uppercase tracking-[0.18em] text-text-secondary">
                {orders.length} recent {orders.length === 1 ? "order" : "orders"}
              </p>
            </div>

            {orders.length > 0 ? (
              <div className="divide-y divide-border overflow-hidden rounded-[12px] border border-border">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="grid gap-3 bg-surface p-4 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <LookupMetric label="Job" value={order.jobNumber} />
                      <LookupMetric label="Session" value={order.sessionDate} />
                      <LookupMetric label="Package" value={order.packageName} />
                      <div>
                        <p className="text-xs text-text-secondary">Status</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <OrderStatusBadge status={order.orderStatus} />
                          <InvoiceStatusBadge status={order.invoiceStatus} />
                          <span className="inline-flex rounded-full bg-surface-soft px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                            {order.paymentStatus}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button size="sm" asChild>
                      <Link href={`/orders/${order.id}/sales`}>
                        Open Sales
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-[12px] border border-dashed border-border bg-surface-soft p-4 text-sm text-text-secondary">
                Customer found, but no orders are linked to this phone number yet.
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-[12px] border border-dashed border-border bg-surface-soft p-4 text-sm text-text-secondary">
            No customer found for this phone number.
          </p>
        )}
      </div>
    </section>
  );
}

function LookupMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
