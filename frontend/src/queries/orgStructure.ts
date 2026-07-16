import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  orgStructureService,
  type DesignationCreatePayload,
  type OrgStructure,
} from "../services/orgStructure.service";
import { departmentsQueryKey, designationsQueryKey } from "./adminReferenceData";

export const orgStructureQueryKey = ["admin", "organization"] as const;

export function useOrgStructure() {
  return useQuery<OrgStructure>({
    queryKey: orgStructureQueryKey,
    queryFn: () => orgStructureService.get(),
  });
}

/** Every dept/designation write refreshes the org-structure view AND the shared
 *  reference-data caches (departments/designations power UserModal, UsersTab,
 *  ProjectModal, Notify, Management Review) plus the competency-framework query
 *  (its department picker + role list derive from these). Partial invalidation
 *  would leave other admin surfaces stale. */
function useOrgWrite<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgStructureQueryKey });
      qc.invalidateQueries({ queryKey: departmentsQueryKey });
      qc.invalidateQueries({ queryKey: designationsQueryKey });
      qc.invalidateQueries({ queryKey: ["admin", "competency-framework"] });
    },
  });
}

export const useCreateDepartment = () =>
  useOrgWrite((name: string) => orgStructureService.createDepartment(name));

export const useRenameDepartment = () =>
  useOrgWrite((v: { id: number; name: string }) =>
    orgStructureService.renameDepartment(v.id, v.name),
  );

export const useDeactivateDepartment = () =>
  useOrgWrite((id: number) => orgStructureService.deactivateDepartment(id));

export const useReactivateDepartment = () =>
  useOrgWrite((id: number) => orgStructureService.reactivateDepartment(id));

export const useCreateDesignation = () =>
  useOrgWrite((v: DesignationCreatePayload) => orgStructureService.createDesignation(v));

export const useRenameDesignation = () =>
  useOrgWrite((v: { id: number; name: string }) =>
    orgStructureService.renameDesignation(v.id, v.name),
  );

export const useDeactivateDesignation = () =>
  useOrgWrite((id: number) => orgStructureService.deactivateDesignation(id));

export const useReactivateDesignation = () =>
  useOrgWrite((id: number) => orgStructureService.reactivateDesignation(id));
