"use client";

import Link from "next/link";
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
import { PackageArchiveButton } from "./package-archive-button";

export type { Package };

interface PackagesTableProps {
  packages: Package[];
}

export function PackagesTable({ packages }: PackagesTableProps) {
  if (packages.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface px-6 py-10 text-center">
        <p className="text-sm font-medium text-text-primary">
          No packages yet
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Create a structured package from product deliverables.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-surface-soft">
            <TableHead className="text-text-secondary">Name</TableHead>
            <TableHead className="text-text-secondary">Price</TableHead>
            <TableHead className="text-text-secondary">Deliverables</TableHead>
            <TableHead className="text-text-secondary">Bundle Adjustment</TableHead>
            <TableHead className="text-text-secondary">References</TableHead>
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
                <div>{pkg.name}</div>
                {pkg.description ? (
                  <p className="mt-1 max-w-md text-xs font-normal text-text-secondary">
                    {pkg.description}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {pkg.price}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <p className="max-w-lg">{pkg.deliverableSummary}</p>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {pkg.bundleAdjustment}
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                {pkg.totalReferenceCount}
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
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem asChild>
                      <Link href={`/packages/${pkg.id}/edit`}>Edit</Link>
                    </DropdownMenuItem>
                    <PackageArchiveButton
                      packageId={pkg.id}
                      activeReferenceCount={pkg.activeReferenceCount}
                      totalReferenceCount={pkg.totalReferenceCount}
                    />
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
