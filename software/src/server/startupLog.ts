export interface StartupValidationErrorSummary {
  errorCount: number;
  firstErrors: string[];
  truncatedCount: number;
}

export function summarizeStartupValidationErrors(errors: string[], limit = 10): StartupValidationErrorSummary {
  const firstErrors = errors.slice(0, limit);
  return {
    errorCount: errors.length,
    firstErrors,
    truncatedCount: Math.max(0, errors.length - firstErrors.length)
  };
}
