import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../types";

export const SESSION_COOKIE = "sw_session";

const DAY_SECONDS = 86_400;

/** `Secure` só em HTTPS, para o desenvolvimento local em http://localhost funcionar em todos os browsers. */
function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context<AppEnv>, token: string, ttlDays: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isHttps(c),
    maxAge: ttlDays * DAY_SECONDS,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(c) });
}
