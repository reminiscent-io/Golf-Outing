import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-do-not-use-in-prod";
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export type SessionPayload = {
  userId: number;
};

export type VerifiedSession = SessionPayload & {
  iat: number;
  exp: number;
};

export function signSession(userId: number): { token: string; expiresAt: Date } {
  const token = jwt.sign({ userId }, SECRET, { expiresIn: TTL_SECONDS });
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
  return { token, expiresAt };
}

export function verifySession(token: string): VerifiedSession | null {
  try {
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload & SessionPayload;
    if (typeof decoded !== "object" || typeof decoded.userId !== "number") return null;
    return {
      userId: decoded.userId,
      iat: decoded.iat ?? 0,
      exp: decoded.exp ?? 0,
    };
  } catch {
    return null;
  }
}
