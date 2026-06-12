import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyScheduleFailure,
  applyScheduleSuccess,
  DEFAULT_SCHEDULE_MAX_CONSECUTIVE_FAILURES,
  resolveScheduleMaxConsecutiveFailures,
  SCHEDULE_CONSECUTIVE_FAILURES_KEY,
  scheduleConsecutiveFailures
} from "../packages/db/src/schedule-policy";

test("resolveScheduleMaxConsecutiveFailures falls back to the default", () => {
  assert.equal(resolveScheduleMaxConsecutiveFailures(undefined), DEFAULT_SCHEDULE_MAX_CONSECUTIVE_FAILURES);
  assert.equal(resolveScheduleMaxConsecutiveFailures("not-a-number"), DEFAULT_SCHEDULE_MAX_CONSECUTIVE_FAILURES);
  assert.equal(resolveScheduleMaxConsecutiveFailures("3"), 3);
  assert.equal(resolveScheduleMaxConsecutiveFailures("0"), 1);
  assert.equal(resolveScheduleMaxConsecutiveFailures("100000"), 1000);
});

test("scheduleConsecutiveFailures reads only valid counters", () => {
  assert.equal(scheduleConsecutiveFailures(undefined), 0);
  assert.equal(scheduleConsecutiveFailures({}), 0);
  assert.equal(scheduleConsecutiveFailures({ [SCHEDULE_CONSECUTIVE_FAILURES_KEY]: "garbage" }), 0);
  assert.equal(scheduleConsecutiveFailures({ [SCHEDULE_CONSECUTIVE_FAILURES_KEY]: -2 }), 0);
  assert.equal(scheduleConsecutiveFailures({ [SCHEDULE_CONSECUTIVE_FAILURES_KEY]: 4 }), 4);
});

test("applyScheduleFailure increments and disables at the threshold", () => {
  const first = applyScheduleFailure({ metadata: {}, maxConsecutiveFailures: 3 });
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(first.shouldDisable, false);

  const second = applyScheduleFailure({ metadata: first.metadata, maxConsecutiveFailures: 3 });
  assert.equal(second.consecutiveFailures, 2);
  assert.equal(second.shouldDisable, false);

  const third = applyScheduleFailure({ metadata: second.metadata, maxConsecutiveFailures: 3 });
  assert.equal(third.consecutiveFailures, 3);
  assert.equal(third.shouldDisable, true);
});

test("applyScheduleFailure preserves unrelated metadata", () => {
  const failure = applyScheduleFailure({
    metadata: { owner: "tester" },
    maxConsecutiveFailures: 5
  });
  assert.equal(failure.metadata.owner, "tester");
  assert.equal(failure.metadata[SCHEDULE_CONSECUTIVE_FAILURES_KEY], 1);
});

test("applyScheduleSuccess clears the failure counter once", () => {
  const failed = applyScheduleFailure({ metadata: { owner: "tester" }, maxConsecutiveFailures: 5 });

  const reset = applyScheduleSuccess(failed.metadata);
  assert.equal(reset.changed, true);
  assert.equal(reset.metadata.owner, "tester");
  assert.equal(SCHEDULE_CONSECUTIVE_FAILURES_KEY in reset.metadata, false);

  const repeat = applyScheduleSuccess(reset.metadata);
  assert.equal(repeat.changed, false);
});
