import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PackageStatusBadge } from "./package-status-badge";
import type { Package } from "@/modules/packages/package.types";

export type { Package };

interface PackagesTableProps {
  packages: Package[];
}

export function PackagesTable({ packages }: PackagesTableProps) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Name</TableHead>
            <TableHead className="text-text-secondary">Price</TableHead>
            <TableHead className="text-text-secondary">Photos Included</TableHead>
            <TableHead className="text-text-secondary">Description</TableHead>
            <TableHead className="text-text-secondary">Bookings</TableHead>
            <TableHead className="text-text-secondary">Status</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.map((pkg) => (
            <TableRow
              key={pkg.id}
              className="border-border hover:bg-surface-soft"
            >
              <TableCell className="font-medium text-text-primary">
                {pkg.name}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {pkg.price}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {pkg.photoCount}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {pkg.description}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {pkg.bookingCount}
              </TableCell>
              <TableCell>
                <PackageStatusBadge status={pkg.status} />
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Open actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Edit</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
