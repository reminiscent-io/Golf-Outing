import type { Request, Response, NextFunction } from "express";
import { verifySession } from "../lib/jwt";

export type OptionallyAuthedRequest = Request & { user?: { id: number } };

export function optionalAuth(req: OptionallyAuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    const session = verifySession(token);
    if (session) {
      req.user = { id: session.userId };
    }
  }
  next();
}
