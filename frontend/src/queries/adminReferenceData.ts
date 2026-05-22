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
 * No mutation hooks here — the backend doesn't expose CRUD for these
 * endpoints from the frontend yet.
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
