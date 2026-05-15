import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  RequestOtpBody,
  VerifyOtpBody,
  UpdateMeBody,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";
import { logger } from "../lib/logger";
import { startVerification, checkVerification } from "../lib/twilio";
import { normalizePhone } from "../lib/otp";
import { signSession } from "../lib/jwt";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

// In-memory rate limit keyed by phone: 1/30s & 5/15m
type RateState = { last: number; recent: number[] };
const rateMap = new Map<string, RateState>();

function checkRate(phone: string): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  const state = rateMap.get(phone) ?? { last: 0, recent: [] };
  const sinceLast = now - state.last;
  if (sinceLast < 30_000) {
    return { ok: false, retryAfterMs: 30_000 - sinceLast };
  }
  state.recent = state.recent.filter(t => now - t < 15 * 60_000);
  if (state.recent.length >= 5) {
    const oldest = state.recent[0];
    return { ok: false, retryAfterMs: 15 * 60_000 - (now - oldest) };
  }
  state.last = now;
  state.recent.push(now);
  rateMap.set(phone, state);
  return { ok: true };
}

router.post("/auth/request-otp", async (req, res): Promise<void> => {
  const parsed = RequestOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid phone number; use E.164 format" });
    return;
  }
  const rate = checkRate(phone);
  if (!rate.ok) {
    res.setHeader("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ error: "Too many OTP requests" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
  const isNewUser = !existing;

  try {
    await startVerification(phone);
  } catch (err) {
    logger.error({ err, phone }, "Failed to start Twilio Verify");
    res.status(502).json({ error: "Failed to send verification code" });
    return;
  }

  // Verify owns the code lifetime (default 10 min). Surface a nominal expiresAt for UX.
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  res.json({ ok: true, expiresAt: expiresAt.toISOString(), isNewUser });
});

router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }
  const code = String(parsed.data.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "Invalid code format" });
    return;
  }

  let valid: boolean;
  try {
    valid = await checkVerification(phone, code);
  } catch (err) {
    logger.error({ err, phone }, "Twilio Verify check threw");
    res.status(502).json({ error: "Verification service unavailable" });
    return;
  }
  if (!valid) {
    res.status(401).json({ error: "Wrong or expired code" });
    return;
  }

  // Find or create user.
  let [user] = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
  if (!user) {
    const fullName = String(parsed.data.fullName ?? "").trim();
    if (!fullName) {
      res.status(400).json({ error: "fullName is required for new users" });
      return;
    }
    const [created] = await db
      .insert(usersTable)
      .values({ phone, fullName, lastLoginAt: new Date() })
      .returning();
    user = created;
  } else {
    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id));
  }

  const { token, expiresAt } = signSession(user.id);
  res.json({ token, expiresAt: expiresAt.toISOString(), user: ser(user) });
});

router.get("/auth/me", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(ser(user));
});

router.patch("/auth/me", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const patch: { handicap?: number | null } = {};
  if (parsed.data.handicap !== undefined) {
    patch.handicap = parsed.data.handicap;
  }
  if (Object.keys(patch).length === 0) {
    const [current] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
    if (!current) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json(ser(current));
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, req.user.id))
    .returning();
  if (!updated) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(ser(updated));
});

router.post("/auth/refresh", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  const { token, expiresAt } = signSession(user.id);
  res.json({ token, expiresAt: expiresAt.toISOString(), user: ser(user) });
});

export default router;
