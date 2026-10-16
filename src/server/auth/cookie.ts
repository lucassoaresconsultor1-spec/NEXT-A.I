// Shared by the proxy and the session module; no server-only imports here.

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/** `__Host-` binds the cookie to the exact host over HTTPS (no Domain, Path=/). */
export function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-varejo_session" : "varejo_session";
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
