import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { setUnauthorizedHandler } from "../api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});
