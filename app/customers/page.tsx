import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { CustomersFilters } from "@/components/customers/customers-filters";
import { CustomersTable, type Customer } from "@/components/customers/customers-table";

const MOCK_CUSTOMERS: Customer[] = [
  {
    id: "#CU-0001",
    fullName: "Fatima Al-Harbi",
    phone: "+966 50 111 2233",
    childrenCount: 2,
    totalBookings: 5,
    lastSessionDate: "2 May 2026",
    status: "Active",
  },
  {
    id: "#CU-0002",
    fullName: "Sara Al-Mutairi",
    phone: "+966 55 223 4455",
    childrenCount: 1,
    totalBookings: 3,
    lastSessionDate: "28 Apr 2026",
    status: "Active",
  },
  {
    id: "#CU-0003",
    fullName: "Hessa Al-Dosari",
    phone: "+966 50 334 5566",
    childrenCount: 3,
    totalBookings: 7,
    lastSessionDate: "20 Apr 2026",
    status: "Active",
  },
  {
    id: "#CU-0004",
    fullName: "Nora Al-Qahtani",
    phone: "+966 54 445 6677",
    childrenCount: 1,
    totalBookings: 2,
    lastSessionDate: "15 Mar 2026",
    status: "Inactive",
  },
  {
    id: "#CU-0005",
    fullName: "Lama Al-Shehri",
    phone: "+966 56 556 7788",
    childrenCount: 2,
    totalBookings: 4,
    lastSessionDate: "1 May 2026",
    status: "Active",
  },
  {
    id: "#CU-0006",
    fullName: "Reem Al-Zahrani",
    phone: "+966 50 667 8899",
    childrenCount: 1,
    totalBookings: 1,
    lastSessionDate: "10 Feb 2026",
    status: "Inactive",
  },
  {
    id: "#CU-0007",
    fullName: "Maha Al-Ghamdi",
    phone: "+966 55 778 9900",
    childrenCount: 4,
    totalBookings: 9,
    lastSessionDate: "3 May 2026",
    status: "Active",
  },
  {
    id: "#CU-0008",
    fullName: "Dana Al-Qurashi",
    phone: "+966 54 889 0011",
    childrenCount: 2,
    totalBookings: 6,
    lastSessionDate: "30 Apr 2026",
    status: "Active",
  },
  {
    id: "#CU-0009",
    fullName: "Eman Al-Otaibi",
    phone: "+966 56 990 1122",
    childrenCount: 1,
    totalBookings: 2,
    lastSessionDate: "5 Jan 2026",
    status: "Inactive",
  },
  {
    id: "#CU-0010",
    fullName: "Wafa Al-Rashid",
    phone: "+966 50 001 2233",
    childrenCount: 3,
    totalBookings: 8,
    lastSessionDate: "1 May 2026",
    status: "Active",
  },
];

export default function CustomersPage() {
  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold text-text-primary">
              Customers
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              View and manage your studio customers
            </p>
          </div>
          <Button className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            New Customer
          </Button>
        </div>

        {/* Filters */}
        <CustomersFilters />

        {/* Table */}
        <CustomersTable customers={MOCK_CUSTOMERS} />
      </div>
    </PageContainer>
  );
}
