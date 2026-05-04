import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { BookingsFilters } from "@/components/bookings/bookings-filters";
import { BookingsTable, type Booking } from "@/components/bookings/bookings-table";

const MOCK_BOOKINGS: Booking[] = [
  {
    id: "#BK-1001",
    customerName: "Fatima Al-Harbi",
    sessionDate: "4 May 2026, 09:00",
    package: "Premium Newborn",
    status: "Confirmed",
    paymentStatus: "Paid",
    assignedStaff: "Ahmed Al-Rashid",
  },
  {
    id: "#BK-1002",
    customerName: "Sara Al-Mutairi",
    sessionDate: "4 May 2026, 10:30",
    package: "Standard Kids",
    status: "Confirmed",
    paymentStatus: "Partial",
    assignedStaff: "Khalid Al-Otaibi",
  },
  {
    id: "#BK-1003",
    customerName: "Hessa Al-Dosari",
    sessionDate: "4 May 2026, 12:00",
    package: "Basic Newborn",
    status: "Pending",
    paymentStatus: "Unpaid",
    assignedStaff: "Ahmed Al-Rashid",
  },
  {
    id: "#BK-1004",
    customerName: "Nora Al-Qahtani",
    sessionDate: "5 May 2026, 14:00",
    package: "Premium Kids",
    status: "Confirmed",
    paymentStatus: "Paid",
    assignedStaff: "Khalid Al-Otaibi",
  },
  {
    id: "#BK-1005",
    customerName: "Lama Al-Shehri",
    sessionDate: "5 May 2026, 15:30",
    package: "Standard Newborn",
    status: "Cancelled",
    paymentStatus: "Refunded",
    assignedStaff: "Ahmed Al-Rashid",
  },
  {
    id: "#BK-1006",
    customerName: "Reem Al-Zahrani",
    sessionDate: "6 May 2026, 09:00",
    package: "Premium Newborn",
    status: "Confirmed",
    paymentStatus: "Paid",
    assignedStaff: "Khalid Al-Otaibi",
  },
  {
    id: "#BK-1007",
    customerName: "Maha Al-Ghamdi",
    sessionDate: "6 May 2026, 11:00",
    package: "Basic Kids",
    status: "Pending",
    paymentStatus: "Unpaid",
    assignedStaff: "Ahmed Al-Rashid",
  },
  {
    id: "#BK-1008",
    customerName: "Dana Al-Qurashi",
    sessionDate: "7 May 2026, 13:00",
    package: "Standard Kids",
    status: "Completed",
    paymentStatus: "Paid",
    assignedStaff: "Khalid Al-Otaibi",
  },
];

export default function BookingsPage() {
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
          <Button className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            New Booking
          </Button>
        </div>

        {/* Filters */}
        <BookingsFilters />

        {/* Table */}
        <BookingsTable bookings={MOCK_BOOKINGS} />
      </div>
    </PageContainer>
  );
}
