// Vitest setup file — runs once per test worker before any test file.
// Extends `expect` with the DOM-aware matchers from jest-dom so we can
// write `expect(element).toBeInTheDocument()` and friends.
import "@testing-library/jest-dom/vitest";
