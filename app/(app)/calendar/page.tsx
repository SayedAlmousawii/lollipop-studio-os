import { CalendarGrid } from "@/components/calendar/calendar-grid";
import { PageContainer } from "@/components/layout/page-container";
import { getCalendarEvents } from "@/modules/calendar/calendar.service";

export default async function CalendarPage() {
  const events = await getCalendarEvents();

  return (
    <PageContainer>
      <CalendarGrid events={events} />
    </PageContainer>
  );
}
