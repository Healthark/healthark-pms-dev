import apiClient from "./api.client";

/**
 * Mirrors the backend's TokenResponse schema exactly.
 * `features` is the authoritative list of modules this org has licensed.
 */
export interface AuthResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  full_name: string;
  role: string;
  org_id: number;
  features: string[]; // e.g. ["dashboard", "goals", "project_reviews", "mentoring"]
  // True when at least one active user reports to this user via mentor_id.
  // Drives mentor-only UI (Team Goals tab, etc.) regardless of role.
  has_mentees: boolean;
}

export const authService = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    // FastAPI's OAuth2PasswordRequestForm requires form-data, not JSON
    const formData = new URLSearchParams();
    formData.append("username", email);
    formData.append("password", password);

    const response = await apiClient.post<AuthResponse>(
      "/auth/login",
      formData,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    return response.data;
  },

  logout: (): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  },
};
