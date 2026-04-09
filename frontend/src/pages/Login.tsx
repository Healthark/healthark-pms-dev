import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, Loader2 } from "lucide-react";
import { authService } from "../services/auth.service";
import { useAuth } from "../hooks/useAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Typed shape of an Axios error response from our FastAPI backend.
 * FastAPI returns validation/auth errors as `{ detail: string }`.
 * Using `unknown` for the catch block and narrowing is the ESLint-safe approach.
 */
interface ApiErrorResponse {
  response?: {
    data?: {
      detail?: string;
    };
  };
}

function isApiError(error: unknown): error is ApiErrorResponse {
  return typeof error === "object" && error !== null && "response" in error;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Login() {
  const navigate = useNavigate();
  const { user, login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  /**
   * Auth Guard: If the user is already authenticated (e.g. they hit /login
   * while a valid session exists in localStorage), redirect them immediately.
   * This prevents the "back button after logout" flash issue.
   */
  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const handleLogin = async (
    e: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const data = await authService.login(email, password);

      /**
       * FIX: Delegate ALL auth state management to the context.
       * AuthContext.login() handles both localStorage persistence AND
       * React state update — Login.tsx must not touch localStorage directly.
       * The useEffect above will then fire and redirect to /dashboard.
       */
      login(data);
    } catch (err: unknown) {
      const message = isApiError(err)
        ? (err.response?.data?.detail ?? "An unexpected error occurred.")
        : "Connection to server failed. Please try again.";

      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <img
            src="/healtharklogov2.png"
            alt="Healthark Performance Management System"
            className="h-12 w-auto object-contain"
          />
        </div>
        <h2 className="mt-6 text-center text-2xl font-display font-bold text-text-main">
          Sign in to your account
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-surface py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-border">
          <form className="space-y-6" onSubmit={handleLogin} noValidate>
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg text-center"
              >
                {error}
              </div>
            )}

            {/* Email Field */}
            <div>
              <label
                htmlFor="email-address"
                className="block text-sm font-medium text-text-main mb-1"
              >
                Email address
              </label>
              <div className="relative">
                <div
                  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
                  aria-hidden="true"
                >
                  <Mail className="h-5 w-5 text-text-muted" />
                </div>
                <input
                  id="email-address"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand bg-background text-text-main sm:text-sm transition-colors"
                  placeholder="david@healthark.com"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-text-main mb-1"
              >
                Password
              </label>
              <div className="relative">
                <div
                  className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
                  aria-hidden="true"
                >
                  <Lock className="h-5 w-5 text-text-muted" />
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand bg-background text-text-main sm:text-sm transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              aria-busy={isLoading}
              className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand disabled:opacity-70 disabled:cursor-not-allowed transition-all"
            >
              {isLoading ? (
                <>
                  <Loader2
                    className="h-5 w-5 animate-spin"
                    aria-hidden="true"
                  />
                  <span className="sr-only">Signing in…</span>
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
