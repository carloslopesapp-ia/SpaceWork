import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { setUnauthorizedHandler } from "../api";

afterEach(() => {
  cleanup();
  localStorage.clear(); // a vista escolhida (lista ou mosaico) não passa de um teste para o seguinte
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});
