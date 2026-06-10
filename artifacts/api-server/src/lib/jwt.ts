import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export type SessionPayload = {
  userId: number;
};

export type VerifiedSession = SessionPayload & {
  iat: number;
  exp: number;
};

export function getSecret(): string {
  if (!SECRET) {
    throw new Error("JWT_SECRET environment variable is required but not set. Refusing to sign or verify tokens.");
  }
  return SECRET;
}

export function signSession(userId: number): { token: string; expiresAt: Date } {
  const token = jwt.sign({ userId }, getSecret(), { expiresIn: TTL_SECONDS });
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
  return { token, expiresAt };
}

export function verifySession(token: string): VerifiedSession | null {
  try {
    const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload & SessionPayload;
    if (typeof decoded !== "object" || typeof decoded.userId !== "number") return null;
    // Reject tokens that have no expiry — every legitimate session token includes exp
    if (typeof decoded.exp !== "number") return null;
    return {
      userId: decoded.userId,
      iat: decoded.iat ?? 0,
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}
