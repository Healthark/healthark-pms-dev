import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  competencyFrameworkService,
  type FrameworkResponse,
} from "../services/competencyFramework.service";
import { designationsQueryKey } from "./adminReferenceData";

export const frameworkQueryKey = (deptId: number | null) =>
  ["admin", "competency-framework", deptId ?? "default"] as const;

export function useFramework(deptId: number | null, enabled = true) {
  return useQuery<FrameworkResponse>({
    queryKey: frameworkQueryKey(deptId),
    queryFn: () => competencyFrameworkService.getFramework(deptId),
    enabled,
  });
}

/** All framework mutations return the refreshed FrameworkResponse, so we prime
 *  its query cache directly (keyed by the returned department_id). */
function useFrameworkWrite<V>(fn: (v: V) => Promise<FrameworkResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => qc.setQueryData(frameworkQueryKey(data.department_id), data),
  });
}

export function useCreateCompetency() {
  return useFrameworkWrite(
    (v: { departmentId: number | null; label: string; isReviewable: boolean }) =>
      competencyFrameworkService.createCompetency(v.departmentId, v.label, v.isReviewable),
  );
}

export function useUpdateCompetency() {
  return useFrameworkWrite(
    (v: {
      department_id: number | null;
      key: string;
      label?: string;
      is_reviewable?: boolean;
      display_order?: number;
    }) => competencyFrameworkService.updateCompetency(v),
  );
}

export function useDeleteCompetency() {
  return useFrameworkWrite((v: { departmentId: number | null; key: string }) =>
    competencyFrameworkService.deleteCompetency(v.departmentId, v.key),
  );
}

export function useUpdateCell() {
  return useFrameworkWrite((v: { competencyId: number; expectation: string | null }) =>
    competencyFrameworkService.updateCell(v.competencyId, v.expectation),
  );
}

export function useAddLevel() {
  return useFrameworkWrite((v: { departmentId: number; level: number }) =>
    competencyFrameworkService.addLevel(v.departmentId, v.level),
  );
}

/** Setting a designation's level changes which level columns the department
 *  has, so refetch the framework (levels derive from designations) and the
 *  shared designations list. */
export function useSetDesignationLevel(deptId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { designationId: number; level: number }) =>
      competencyFrameworkService.setDesignationLevel(v.designationId, v.level),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: frameworkQueryKey(deptId) });
      qc.invalidateQueries({ queryKey: designationsQueryKey });
    },
  });
}
