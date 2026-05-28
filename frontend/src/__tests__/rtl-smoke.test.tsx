/**
 * Smoke test for the React Testing Library + jsdom + Vitest pipeline.
 *
 * Uses an inline component so we don't depend on any of the app's providers
 * (auth, theme, query client, router) — those each need fixtures and a
 * dedicated test render helper that we'll build out as component-level
 * tests grow. For now, the point of this file is just to prove that
 * `render`, `screen`, and jest-dom matchers all work.
 */
// Explicit React import: the vitest + @vitejs/plugin-react@6 + React 19 combo
// doesn't reliably wire up the automatic JSX runtime for test files. Importing
// React here makes JSX work without depending on the transform pipeline.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// Silence unused-React warning under noUnusedLocals — JSX needs it at runtime.
void React;

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}!</p>;
}

describe("RTL smoke", () => {
  it("renders the greeting with the provided name", () => {
    render(<Greeting name="Aakash" />);
    expect(screen.getByText("Hello, Aakash!")).toBeInTheDocument();
  });
});
