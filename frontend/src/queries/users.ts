import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  adminService,
  type UserCreatePayload,
  type UserQuery,
  type UserResponse,
  type UserUpdatePayload,
} from "../services/admin.service";
import type { Page } from "../services/pagination";

/**
 * Shared key prefix for everything user-list. The non-paginated picker
 * list (`useUsers`) is keyed exactly `["users"]`; the paginated table
 * list (`useUsersPage`) is keyed `["users", "page", params]`. Both share
 * the `["users"]` prefix, so a single mutation invalidation refreshes
 * the pickers AND the table.
 */
export const usersQueryKey = ["users"] as const;
export const usersPageQueryKey = (params: UserQuery) =>
  ["users", "page", params] as const;

/** Full, non-paginated user list for client-side pickers (UserCombobox,
 *  ProjectsTab PM/secondary picker). Hits /admin/users/all. */
export function useUsers() {
  return useQuery<UserResponse[]>({
    queryKey: usersQueryKey,
    queryFn: () => adminService.getUsers(),
  });
}

/** Paginated user list for the Admin Users table. Param-keyed so each
 *  page/filter/sort view is its own cache entry; keepPreviousData avoids
 *  blanking the table on page/filter changes. */
export function useUsersPage(params: UserQuery) {
  return useQuery<Page<UserResponse>>({
    queryKey: usersPageQueryKey(params),
    queryFn: () => adminService.getUsersPage(params),
    placeholderData: keepPreviousData,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UserCreatePayload) => adminService.createUser(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: number;
      payload: UserUpdatePayload;
    }) => adminService.updateUser(userId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey });
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => adminService.deactivateUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey });
    },
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => adminService.reactivateUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey });
    },
  });
}
