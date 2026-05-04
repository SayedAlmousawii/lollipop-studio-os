import { Camera, DollarSign, ClipboardList, Users } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { StatCard } from "@/components/dashboard/stat-card";
import { SectionHeader } from "@/components/dashboard/section-header";
import { ScheduleItem, type ScheduleStatus } from "@/components/dashboard/schedule-item";
import { ActivityItem } from "@/components/dashboard/activity-item";

const kpiCards: { title: string; value: string; subtext: string; icon: React.ReactNode }[] = [
  {
    title: "Today's Sessions",
    value: "6",
    subtext: "4 confirmed · 2 pending",
    icon: <Camera size={18} />,
  },
  {
    title: "Revenue Today",
    value: "SAR 3,200",
    subtext: "Up from SAR 2,800 yesterday",
    icon: <DollarSign size={18} />,
  },
  {
    title: "Pending Tasks",
    value: "11",
    subtext: "3 editing · 5 awaiting selection · 3 pickups",
    icon: <ClipboardList size={18} />,
  },
  {
    title: "New Customers",
    value: "2",
    subtext: "This week: 9 total",
    icon: <Users size={18} />,
  },
];

const scheduleItems: { time: string; customerName: string; status: ScheduleStatus }[] = [
  { time: "09:00", customerName: "Fatima Al-Harbi", status: "Confirmed" },
  { time: "10:30", customerName: "Sara Al-Mutairi", status: "Confirmed" },
  { time: "12:00", customerName: "Hessa Al-Dosari", status: "Pending" },
  { time: "14:00", customerName: "Nora Al-Qahtani", status: "Confirmed" },
  { time: "15:30", customerName: "Lama Al-Shehri", status: "Cancelled" },
  { time: "17:00", customerName: "Reem Al-Zahrani", status: "Confirmed" },
];

const activityItems: { timestamp: string; description: string }[] = [
  { timestamp: "10 min ago", description: "Photos uploaded for Sara Al-Mutairi (Session #1042)" },
  { timestamp: "45 min ago", description: "Editing completed for Nora Al-Qahtani (Session #1038)" },
  { timestamp: "1 hr ago", description: "Deposit received from Hessa Al-Dosari — SAR 500" },
  { timestamp: "2 hrs ago", description: "Package upgraded for Lama Al-Shehri — Standard → Premium" },
  { timestamp: "3 hrs ago", description: "Order #1041 marked as Ready for Pickup" },
  { timestamp: "Yesterday", description: "Commission approved for Photographer: Ahmed Al-Rashid" },
];

export default function DashboardPage() {
  return (
    <PageContainer>
      <div className="space-y-8">
        <section>
          <SectionHeader title="Overview" description="Today's at-a-glance summary" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map((card) => (
              <StatCard key={card.title} {...card} />
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-[14px] border border-border bg-surface p-5">
            <SectionHeader title="Today's Schedule" description="Upcoming sessions and bookings" />
            <div className="mt-4">
              {scheduleItems.map((item, i) => (
                <ScheduleItem key={i} {...item} />
              ))}
            </div>
          </section>

          <section className="rounded-[14px] border border-border bg-surface p-5">
            <SectionHeader title="Recent Activity" description="Latest workflow updates" />
            <div className="mt-4">
              {activityItems.map((item, i) => (
                <ActivityItem key={i} {...item} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
