import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextType } from "../contexts/AuthContext";
import { SESSION_EXPIRED_KEY } from "../hooks/useIdleTimeout";
import { Login } from "./Login";

const NOTICE = /session expired due to inactivity/i;

// Logged-out auth context so Login renders its form (not the <Navigate> redirect).
const authValue: AuthContextType = {
  user: null,
  isAuthenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
  hasFeature: () => false,
  refreshSession: vi.fn(),
};

function renderLogin() {
  return render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("Login idle-expiry notice", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("shows the notice when the idle marker is set, then clears it", () => {
    sessionStorage.setItem(SESSION_EXPIRED_KEY, "idle");
    renderLogin();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    // Read-and-clear: it must not persist into a later visit.
    expect(sessionStorage.getItem(SESSION_EXPIRED_KEY)).toBeNull();
  });

  it("shows no notice on a normal visit", () => {
    renderLogin();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
