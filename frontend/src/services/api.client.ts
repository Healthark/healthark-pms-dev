import axios from "axios";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);

const apiClient = axios.create({
  baseURL: "https://healthark-pms-dev.onrender.com/api/v1",
  // Send the HttpOnly auth cookie + the readable csrf cookie on every call.
  // Without this, the browser strips cookies from cross-origin requests.
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

function readCookie(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : null;
}

// REQUEST INTERCEPTOR: double-submit CSRF token on mutating requests.
// The JWT itself is no longer touched here — it rides in the HttpOnly cookie
// that the browser attaches automatically thanks to `withCredentials`.
apiClient.interceptors.request.use((config) => {
  const method = (config.method ?? "get").toLowerCase();
  if (MUTATING_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) {
      config.headers[CSRF_HEADER_NAME] = csrf;
    }
  }
  return config;
});

function forceLogout(): void {
  // Ask the server to clear the HttpOnly cookies it set. Fire-and-forget —
  // a failure here doesn't change the fact that we want the local session
  // gone. Use `fetch` (not apiClient) to avoid being re-intercepted.
  try {
    void fetch(`${apiClient.defaults.baseURL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    /* best effort */
  }
  localStorage.removeItem("user");
  if (globalThis.location.pathname !== "/login") {
    globalThis.location.href = "/login";
  }
}

// Treat 401 as "invalid/expired token" and 403 with a deactivation message as
// "account revoked after login" — both require clearing local session state.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const detail = error.response?.data?.detail;
    const isDeactivated =
      status === 403 &&
      typeof detail === "string" &&
      detail.toLowerCase().includes("deactivated");

    if (status === 401 || isDeactivated) {
      forceLogout();
    }
    return Promise.reject(error);
  },
);

export default apiClient;
