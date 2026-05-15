import { useEffect, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export type AuthUser = {
  id: number;
  phone: string;
  fullName: string;
  handicap?: number | null;
  createdAt: string;
};

export function updateSessionUser(patch: Partial<AuthUser>): void {
  const current = readSession();
  if (!current) return;
  setSession({ ...current, user: { ...current.user, ...patch } });
}

export type AuthSession = {
  token: string;
  expiresAt: string;
  user: AuthUser;
};

const KEY = "auth:session";
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.token === "string" &&
      typeof parsed.expiresAt === "string" &&
      parsed.user &&
      typeof parsed.user.id === "number"
    ) {
      // Treat as expired.
      if (Date.parse(parsed.expiresAt) <= Date.now()) {
        return null;
      }
      return parsed as AuthSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function getSession(): AuthSession | null {
  return readSession();
}

export function setSession(session: AuthSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
}

export function useAuthSession(): AuthSession | null {
  const [session, setStateSession] = useState<AuthSession | null>(() => readSession());

  useEffect(() => {
    setStateSession(readSession());
    function onStorage(e: StorageEvent) {
      if (e.key === null || e.key === KEY) {
        setStateSession(readSession());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return session;
}

// Wire the bearer token getter immediately on module load.
setAuthTokenGetter(() => readSession()?.token ?? null);

// Maybe refresh the token if it's getting close to expiry.
export async function maybeRefreshSession(): Promise<void> {
  const session = readSession();
  if (!session) return;
  const remaining = Date.parse(session.expiresAt) - Date.now();
  if (remaining > REFRESH_THRESHOLD_MS) return;
  try {
    // Lazy-fetch directly so we don't have a circular import with the hooks.
    const baseUrl = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.token === "string" && typeof data.expiresAt === "string" && data.user) {
      setSession({ token: data.token, expiresAt: data.expiresAt, user: data.user });
    }
  } catch {
    // Best-effort; ignore.
  }
}
