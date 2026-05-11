import { Camera, ClipboardList, DollarSign, Users } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { StatCard } from "@/components/dashboard/stat-card";
import { SectionHeader } from "@/components/dashboard/section-header";
import { ScheduleItem } from "@/components/dashboard/schedule-item";
import { ActivityItem } from "@/components/dashboard/activity-item";
import { PhoneSalesSearch } from "@/components/dashboard/phone-sales-search";
import { getDashboardData } from "@/modules/dashboard/dashboard.service";

export default async function DashboardPage() {
  const { stats, todaySchedule, recentActivity } = await getDashboardData();

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

        <PhoneSalesSearch />

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
