import apiClient from "./api.client";

export interface UserProfile {
  id: number;
  email: string;
  full_name: string;
  employee_code: string;
  phone: string | null;
  role: string;
  department: string | null;
  designation: string | null;
  mentor_name: string | null;
}

export const profileService = {
  getProfile: async (): Promise<UserProfile> => {
    const res = await apiClient.get<UserProfile>("/auth/me");
    return res.data;
  },

  changePassword: async (
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    await apiClient.post("/users/me/password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },
};
