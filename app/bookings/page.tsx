import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { BookingsFilters } from "@/components/bookings/bookings-filters";
import { BookingsTable } from "@/components/bookings/bookings-table";
import {
  getBookingFilterOptions,
  getBookings,
  parseBookingFilters,
} from "@/modules/bookings/booking.service";

export default async function BookingsPage(props: PageProps<"/bookings">) {
  const filters = parseBookingFilters(await props.searchParams);
  const [bookings, packageOptions] = await Promise.all([
    getBookings(filters),
    getBookingFilterOptions(),
  ]);

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Bookings
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Manage and track all studio session bookings
            </p>
          </div>
          <Button className="shrink-0" asChild>
            <Link href="/bookings/new">
              <Plus className="mr-2 h-4 w-4" />
              New Booking
            </Link>
          </Button>
        </div>

        {/* Filters */}
        <BookingsFilters packageOptions={packageOptions} />

        {/* Table */}
        <BookingsTable bookings={bookings} />
      </div>
    </PageContainer>
  );
}
