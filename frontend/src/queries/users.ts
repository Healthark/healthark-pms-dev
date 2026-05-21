import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminService,
  type UserCreatePayload,
  type UserResponse,
  type UserUpdatePayload,
} from "../services/admin.service";

/**
 * Strict, shared query key for the org-wide user list. Every cache
 * read (UsersTab, UserCombobox, ProjectsTab) and every mutation
 * invalidation references this exact tuple.
 */
export const usersQueryKey = ["users"] as const;

export function useUsers() {
  return useQuery<UserResponse[]>({
    queryKey: usersQueryKey,
    queryFn: () => adminService.getUsers(),
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
