import axios from "axios";

const apiClient = axios.create({
  baseURL: "http://localhost:8000/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
});

// REQUEST INTERCEPTOR: Automatically attach JWT to every request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// RESPONSE INTERCEPTOR: Handle global errors (like 401 Unauthorized)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const isLoginPage = globalThis.location.pathname === "/login";
      if (!isLoginPage) {
    localStorage.removeItem("token");
    globalThis.location.href = "/login";
  }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
