"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { PackageTaxonomyOptions } from "@/modules/packages/package.types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PackagesFiltersProps {
  taxonomyOptions: PackageTaxonomyOptions;
}

export function PackagesFilters({ taxonomyOptions }: PackagesFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const departmentId = searchParams.get("departmentId") ?? "all";
  const sessionTypeId = searchParams.get("sessionTypeId") ?? "all";
  const selectedDepartment = taxonomyOptions.departments.find(
    (department) => department.id === departmentId
  );
  const sessionTypes = selectedDepartment?.sessionTypes ?? [];

  function updateFilter(key: "departmentId" | "sessionTypeId", value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (!value || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    if (key === "departmentId") {
      params.delete("sessionTypeId");
    }

    const query = params.toString();
    router.replace(query ? `/packages?${query}` : "/packages");
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Select
        value={departmentId}
        onValueChange={(value) => updateFilter("departmentId", value)}
      >
        <SelectTrigger className="w-48" aria-label="Filter by department">
          <SelectValue placeholder="Department" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Departments</SelectItem>
          {taxonomyOptions.departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>
              {department.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={sessionTypeId}
        onValueChange={(value) => updateFilter("sessionTypeId", value)}
        disabled={departmentId === "all"}
      >
        <SelectTrigger className="w-48" aria-label="Filter by session type">
          <SelectValue placeholder="Session Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Session Types</SelectItem>
          {sessionTypes.map((sessionType) => (
            <SelectItem key={sessionType.id} value={sessionType.id}>
              {sessionType.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
