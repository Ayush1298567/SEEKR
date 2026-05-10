import type { NextFunction, Request, Response } from "express";
import { loadLocalEnv } from "../env";

loadLocalEnv();

export function requireInternalAuth(req: Request, res: Response, next: NextFunction) {
  const token = process.env.SEEKR_INTERNAL_TOKEN;
  if (!token) {
    next();
    return;
  }

  const headerToken = req.header("x-seekr-token");
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (headerToken === token || bearer === token) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: "Internal token required"
  });
}

export function internalAuthEnabled() {
  return Boolean(process.env.SEEKR_INTERNAL_TOKEN);
}
