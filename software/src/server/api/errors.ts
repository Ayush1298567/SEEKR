import type { ErrorRequestHandler, Response } from "express";
import { ZodError } from "zod";

export function sendError(res: Response, error: unknown, status = 400) {
  if (error instanceof ZodError) {
    res.status(status).json({
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Validation failed",
      details: error.flatten()
    });
    return;
  }
  if (error instanceof Error) {
    res.status(status).json({
      ok: false,
      code: "BAD_REQUEST",
      error: error.message
    });
    return;
  }
  res.status(status).json({
    ok: false,
    code: "BAD_REQUEST",
    error: String(error)
  });
}

export const jsonBodyErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  const candidate = error as { type?: string; status?: number; message?: string };
  if (candidate?.type === "entity.parse.failed") {
    res.status(400).json({
      ok: false,
      code: "MALFORMED_JSON",
      error: "Request body must be valid JSON"
    });
    return;
  }
  if (candidate?.type === "entity.too.large" || candidate?.status === 413) {
    res.status(413).json({
      ok: false,
      code: "REQUEST_BODY_TOO_LARGE",
      error: "Request body exceeds the 2mb limit"
    });
    return;
  }
  next(error);
};
