import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, userHandicapHistoryTable } from "@workspace/db";
import {
  RequestOtpBody,
  VerifyOtpBody,
  UpdateMeBody,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";
import { logger } from "../lib/logger";
import { startVerification, checkVerification } from "../lib/twilio";
import { verifyErrorResponse } from "../lib/verify-response";
import { normalizePhone, maskPhone } from "../lib/otp";
import { signSession } from "../lib/jwt";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const GHIN_RE = /^[0-9]{5,12}$/;

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

/**
 * Give back the slot consumed by `checkRate` when the send failed for a reason
 * that isn't the caller's fault (our credentials are broken, or we never
 * reached Twilio). No SMS went out, so throttling the user for 30s — and
 * burning their 5-per-15-minutes budget — would just compound the outage.
 */
function releaseRate(phone: string): void {
  const state = rateMap.get(phone);
  if (!state) return;
  state.recent.pop();
  state.last = state.recent[state.recent.length - 1] ?? 0;
  rateMap.set(phone, state);
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
    const mapped = verifyErrorResponse(err, "start");
    if (mapped.body.code === "config" || mapped.body.code === "network") {
      releaseRate(phone);
    }
    logger.error(
      { err, phone: maskPhone(phone), responseStatus: mapped.status, kind: mapped.body.code },
      "Failed to start Twilio Verify"
    );
    if (mapped.retryAfterSeconds != null) {
      res.setHeader("Retry-After", String(mapped.retryAfterSeconds));
    }
    res.status(mapped.status).json(mapped.body);
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
    const mapped = verifyErrorResponse(err, "check");
    logger.error(
      { err, phone: maskPhone(phone), responseStatus: mapped.status, kind: mapped.body.code },
      "Twilio Verify check threw"
    );
    if (mapped.retryAfterSeconds != null) {
      res.setHeader("Retry-After", String(mapped.retryAfterSeconds));
    }
    res.status(mapped.status).json(mapped.body);
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
    let ghinNumber: string | null = null;
    if (parsed.data.ghinNumber != null) {
      const trimmed = String(parsed.data.ghinNumber).trim();
      if (trimmed !== "") {
        if (!GHIN_RE.test(trimmed)) {
          res.status(400).json({ error: "GHIN number must be 5-12 digits" });
          return;
        }
        ghinNumber = trimmed;
      }
    }
    const [created] = await db
      .insert(usersTable)
      .values({ phone, fullName, ghinNumber, lastLoginAt: new Date() })
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
  const patch: {
    handicap?: number | null;
    ghinNumber?: string | null;
    discoverableByPhone?: boolean;
    profileVisibility?: "public" | "private";
    fullName?: string;
  } = {};
  if (parsed.data.handicap !== undefined) {
    patch.handicap = parsed.data.handicap;
  }
  if (parsed.data.ghinNumber !== undefined) {
    if (parsed.data.ghinNumber === null) {
      patch.ghinNumber = null;
    } else {
      const trimmed = String(parsed.data.ghinNumber).trim();
      if (trimmed === "") {
        patch.ghinNumber = null;
      } else if (!GHIN_RE.test(trimmed)) {
        res.status(400).json({ error: "GHIN number must be 5-12 digits" });
        return;
      } else {
        patch.ghinNumber = trimmed;
      }
    }
  }
  if (parsed.data.discoverableByPhone !== undefined) {
    patch.discoverableByPhone = parsed.data.discoverableByPhone;
  }
  if (parsed.data.profileVisibility !== undefined) {
    patch.profileVisibility = parsed.data.profileVisibility;
  }
  if (parsed.data.fullName !== undefined) {
    patch.fullName = parsed.data.fullName;
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

  const userId = req.user.id;
  const updated = await db.transaction(async (tx) => {
    let priorHandicap: number | null = null;
    if (patch.handicap !== undefined) {
      const [current] = await tx
        .select({ handicap: usersTable.handicap })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      priorHandicap = current?.handicap ?? null;
    }

    const [row] = await tx
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.id, userId))
      .returning();
    if (!row) return null;

    // Log handicap changes (only when set to a number that differs from prior).
    if (
      patch.handicap !== undefined &&
      patch.handicap !== null &&
      patch.handicap !== priorHandicap
    ) {
      await tx.insert(userHandicapHistoryTable).values({
        userId,
        handicap: patch.handicap,
        source: "manual",
      });
    }

    return row;
  });

  if (!updated) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(ser(updated));
});

router.get("/auth/me/handicap-history", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await db
    .select({
      handicap: userHandicapHistoryTable.handicap,
      source: userHandicapHistoryTable.source,
      recordedAt: userHandicapHistoryTable.recordedAt,
    })
    .from(userHandicapHistoryTable)
    .where(eq(userHandicapHistoryTable.userId, req.user.id))
    .orderBy(desc(userHandicapHistoryTable.recordedAt));
  res.json(ser(rows));
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
