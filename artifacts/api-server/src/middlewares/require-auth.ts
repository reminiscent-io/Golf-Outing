import type { Request, Response, NextFunction } from "express";
import { verifySession } from "../lib/jwt";

export type AuthedRequest = Request & { user?: { id: number } };

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  const token = header.slice(7).trim();
  const session = verifySession(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = { id: session.userId };
  next();
}
