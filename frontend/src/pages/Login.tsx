import React, { useState, useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Mail, Lock, Loader2, Building2 } from "lucide-react";
import { authService } from "../services/auth.service";
import { useAuth } from "../hooks/useAuth";

// ─── Types & Configuration ───────────────────────────────────────────────────

type Tenant = "healthark" | "miltenyi";

interface ApiErrorResponse {
  response?: {
    data?: {
      detail?: string;
    };
  };
}

// Narrow: the error looks like an axios error AND the backend sent a plain
// string `detail`. FastAPI 422 returns `detail` as an array of objects —
// those callers should fall through to the generic connection-error copy
// rather than rendering [object Object].
function isApiError(
  error: unknown,
): error is ApiErrorResponse & { response: { data: { detail: string } } } {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return false;
  }
  const detail = (error as ApiErrorResponse).response?.data?.detail;
  return typeof detail === "string";
}

const TENANT_ASSETS = {
  healthark: {
    id: "healthark",
    name: "HealthArk",
    logo: "/healtharklogov2.png",
    // Locked to h-14 for strict consistency
    logoClass: "h-14 w-auto object-contain drop-shadow-sm",
    placeholder: "david@healthark.com",
  },
  miltenyi: {
    id: "miltenyi",
    name: "Miltenyi Biotec",
    logo: "/miltenyi-biotec-logo.svg",
    // Locked to h-14 for strict consistency
    logoClass: "h-14 w-auto object-contain drop-shadow-sm",
    placeholder: "david@miltenyi.com",
  },
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

type LocationState = { from?: { pathname?: string } };

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();

  const intendedPath =
    (location.state as LocationState | null)?.from?.pathname ?? "/dashboard";

  const [activeTenant, setActiveTenant] = useState<Tenant>("healthark");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Pre-Auth Theming: Inject the theme based on the selected tab.
   */
  useEffect(() => {
    // When the auth guard below redirects, this effect is a no-op — the
    // component unmounts immediately. Running the hook unconditionally keeps
    // hook order stable across renders (React Rules of Hooks).
    if (user) return;

    document.documentElement.setAttribute("data-theme", activeTenant);

    let favicon = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }

    if (activeTenant === "miltenyi") {
      favicon.href = "/miltenyi-biotech-small.svg";
      document.title = "Miltenyi Biotec PMS";
    } else {
      favicon.href = "/healtharklogo-small.png";
      document.title = "HealthArk PMS";
    }

  }, [activeTenant, user]);

  // Synchronous redirect for already-authenticated users — avoids the
  // single-frame flash of the login form that useEffect-based redirects cause.
  // Kept AFTER all hooks so hook order stays stable across renders.
  if (user) {
    return <Navigate to={intendedPath} replace />;
  }

  const handleLogin = async (
    e: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const data = await authService.login(email, password);
      login(data);
      navigate(intendedPath, { replace: true });
    } catch (err: unknown) {
      const message = isApiError(err)
        ? err.response.data.detail
        : "Connection to server failed. Please try again.";

      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const currentAssets = TENANT_ASSETS[activeTenant];

  return (
    // Increased to duration-1000 for slow-motion theme shift
    <div className="min-h-screen bg-background transition-colors duration-1000 ease-in-out flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      
      {/* Optional: Subtle dramatic background glow tied to the brand color */}
      <div className="absolute inset-0 bg-brand/5 transition-colors duration-1000 ease-in-out pointer-events-none" />

      {/* ── Container for Cards ── */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col gap-6 relative z-10">
        
        {/* ── Top Card: Tenant Switcher ── */}
        <div className="bg-surface p-1.5 shadow-md rounded-xl border border-border transition-colors duration-1000 ease-in-out">
          <div className="flex gap-1 relative">
            {(Object.keys(TENANT_ASSETS) as Tenant[]).map((tenantKey) => {
              const isActive = activeTenant === tenantKey;
              return (
                <button
                  key={tenantKey}
                  type="button"
                  onClick={() => {
                    setActiveTenant(tenantKey);
                    setError(""); 
                  }}
                  // Slower transitions here (duration-700) and dramatic contrast on the active state
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-lg transition-all duration-700 ease-in-out ${
                    isActive
                      ? "bg-brand text-white shadow-md scale-[1.02]"
                      : "text-text-muted hover:bg-slate-50 hover:text-text-main"
                  }`}
                >
                  <Building2 className={`w-4 h-4 transition-colors duration-700 ${isActive ? 'text-white' : 'text-text-muted'}`} />
                  {TENANT_ASSETS[tenantKey].name}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Bottom Card: Login Form ── */}
        <div className="bg-surface py-8 px-4 shadow-xl sm:rounded-xl sm:px-10 border border-border transition-colors duration-1000 ease-in-out">
          
          {/* Dynamic Logo, PMS Tag, and Header */}
          <div className="flex flex-col items-center justify-center mb-8 gap-3">
            
            {/* PMS Text positioned ABOVE the logo */}
            <span className="text-text-muted font-medium text-lg tracking-[0.15em] animate-[fadeIn_0.8s_ease-in-out]">
              PMS
            </span>

            {/* Logo */}
            <img
              key={currentAssets.id}
              src={currentAssets.logo}
              alt={`${currentAssets.name} Performance Management System`}
              className={`${currentAssets.logoClass} animate-[fadeIn_0.8s_ease-in-out]`}
            />

            <style>{`
              @keyframes fadeIn {
                from { opacity: 0; transform: translateY(5px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </div>

          <form className="space-y-6" onSubmit={handleLogin} noValidate>
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg text-center animate-[fadeIn_0.3s_ease-in-out]"
              >
                {error}
              </div>
            )}

            {/* Email Field */}
            <div>
              <label
                htmlFor="email-address"
                className="block text-sm font-medium text-text-main mb-1 transition-colors duration-1000"
              >
                Email address
              </label>
              <div className="relative">
                <div
                  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
                  aria-hidden="true"
                >
                  <Mail className="h-5 w-5 text-text-muted transition-colors duration-1000" />
                </div>
                <input
                  id="email-address"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand bg-background text-text-main sm:text-sm transition-all duration-1000 outline-none"
                  placeholder={currentAssets.placeholder}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-text-main mb-1 transition-colors duration-1000"
              >
                Password
              </label>
              <div className="relative">
                <div
                  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
                  aria-hidden="true"
                >
                  <Lock className="h-5 w-5 text-text-muted transition-colors duration-1000" />
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand bg-background text-text-main sm:text-sm transition-all duration-1000 outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              aria-busy={isLoading}
              className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-lg shadow-md text-sm font-semibold text-white bg-brand hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-700 mt-8"
            >
              {isLoading ? (
                <>
                  <Loader2
                    className="h-5 w-5 animate-spin mr-2"
                    aria-hidden="true"
                  />
                  <span>Signing in…</span>
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}