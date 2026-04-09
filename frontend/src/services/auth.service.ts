import apiClient from "./api.client";

// Matching your TokenResponse schema from the backend
export interface AuthResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  full_name: string;
  role: string;
  org_id: number;
}

export const authService = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    // FastAPI OAuth2 expects form-data, not JSON for the /login endpoint
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

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  },
};
