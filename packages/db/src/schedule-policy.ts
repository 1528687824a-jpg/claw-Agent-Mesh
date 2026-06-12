export const DEFAULT_SCHEDULE_MAX_CONSECUTIVE_FAILURES = 5;
export const SCHEDULE_CONSECUTIVE_FAILURES_KEY = "consecutiveFailures";

export function resolveScheduleMaxConsecutiveFailures(
  rawValue: string | undefined = process.env.HONEYCOMB_SCHEDULE_MAX_CONSECUTIVE_FAILURES
): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return DEFAULT_SCHEDULE_MAX_CONSECUTIVE_FAILURES;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 1000);
}

export function scheduleConsecutiveFailures(
  metadata: Record<string, unknown> | null | undefined
): number {
  const value = Number((metadata ?? {})[SCHEDULE_CONSECUTIVE_FAILURES_KEY]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

export function applyScheduleFailure(input: {
  metadata?: Record<string, unknown> | null;
  maxConsecutiveFailures?: number;
}): {
  metadata: Record<string, unknown>;
  consecutiveFailures: number;
  shouldDisable: boolean;
} {
  const maxConsecutiveFailures =
    input.maxConsecutiveFailures ?? resolveScheduleMaxConsecutiveFailures();
  const consecutiveFailures = scheduleConsecutiveFailures(input.metadata) + 1;
  return {
    metadata: {
      ...(input.metadata ?? {}),
      [SCHEDULE_CONSECUTIVE_FAILURES_KEY]: consecutiveFailures
    },
    consecutiveFailures,
    shouldDisable: consecutiveFailures >= maxConsecutiveFailures
  };
}

export function applyScheduleSuccess(metadata: Record<string, unknown> | null | undefined): {
  metadata: Record<string, unknown>;
  changed: boolean;
} {
  if (scheduleConsecutiveFailures(metadata) === 0) {
    return { metadata: metadata ?? {}, changed: false };
  }
  const next = { ...(metadata ?? {}) };
  delete next[SCHEDULE_CONSECUTIVE_FAILURES_KEY];
  return { metadata: next, changed: true };
}
