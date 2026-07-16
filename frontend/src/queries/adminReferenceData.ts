import { useQuery } from "@tanstack/react-query";
import {
  adminService,
  type DepartmentBrief,
  type DesignationBrief,
} from "../services/admin.service";

/**
 * Admin reference data — departments and designations. Both are
 * effectively static lists (org structure changes maybe once a quarter)
 * so we override the default 60s staleTime with 15 minutes: once a
 * tab has the data, no further network call within the session unless
 * an explicit invalidation happens.
 *
 * Read hooks only. Department/designation CRUD lives in queries/orgStructure.ts
 * (the admin Organization tab); its mutations invalidate the query keys exported
 * below so these shared dropdowns refresh after any structural change.
 */
const REFERENCE_STALE_TIME = 15 * 60_000;

export const departmentsQueryKey = ["admin", "departments"] as const;
export const designationsQueryKey = ["admin", "designations"] as const;

export function useDepartments() {
  return useQuery<DepartmentBrief[]>({
    queryKey: departmentsQueryKey,
    queryFn: () => adminService.getDepartments(),
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useDesignations() {
  return useQuery<DesignationBrief[]>({
    queryKey: designationsQueryKey,
    queryFn: () => adminService.getDesignations(),
    staleTime: REFERENCE_STALE_TIME,
  });
}
