import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LIMIT_MINUTES,
  createState,
  isValidLimit,
  localDay,
  normalizeState,
  publicState,
  recordHeartbeat,
  setLimit,
} from "../tracking.js";

const noon = (year, month, day) => new Date(year, month - 1, day, 12).getTime();

test("creates the default daily state", () => {
  const now = noon(2026, 9, 28);
  assert.deepEqual(publicState(createState(now), now), {
    day: localDay(now),
    usedMs: 0,
    limitMinutes: DEFAULT_LIMIT_MINUTES,
    bonusRemaining: 0,
    blocked: false,
  });
});

test("resets usage and heartbeat state on a new local day", () => {
  const yesterday = noon(2026, 9, 27);
  const today = noon(2026, 9, 28);
  const state = {
    ...createState(yesterday, 25),
    usedMs: 90_000,
    heartbeatAt: yesterday + 1_000,
    heartbeatActive: true,
    heartbeatTabId: 7,
  };

  assert.deepEqual(normalizeState(state, today), createState(today, 25));
});

test("counts elapsed time between active heartbeats without double counting", () => {
  const now = noon(2026, 9, 28);
  let state = createState(now);

  state = recordHeartbeat(state, {
    now,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
  });
  state = recordHeartbeat(state, {
    now: now + 1_000,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
  });
  state = recordHeartbeat(state, {
    now: now + 2_000,
    tabId: 7,
    active: false,
    isFocusedActiveTab: true,
  });
  state = recordHeartbeat(state, {
    now: now + 3_000,
    tabId: 7,
    active: false,
    isFocusedActiveTab: true,
  });

  assert.equal(state.usedMs, 2_000);
});

test("caps a delayed heartbeat interval at 2500ms", () => {
  const now = noon(2026, 9, 28);
  let state = recordHeartbeat(createState(now), {
    now,
    tabId: 4,
    active: true,
    isFocusedActiveTab: true,
  });

  state = recordHeartbeat(state, {
    now: now + 30_000,
    tabId: 4,
    active: true,
    isFocusedActiveTab: true,
  });

  assert.equal(state.usedMs, 2_500);
});

test("ignores heartbeats from unrelated background tabs", () => {
  const now = noon(2026, 9, 28);
  let state = recordHeartbeat(createState(now), {
    now,
    tabId: 4,
    active: true,
    isFocusedActiveTab: true,
  });

  state = recordHeartbeat(state, {
    now: now + 500,
    tabId: 8,
    active: false,
    isFocusedActiveTab: false,
  });
  state = recordHeartbeat(state, {
    now: now + 1_000,
    tabId: 4,
    active: true,
    isFocusedActiveTab: true,
  });

  assert.equal(state.usedMs, 1_000);
  assert.equal(state.heartbeatTabId, 4);
});

test("a persisted heartbeat cursor survives a worker restart", () => {
  const now = noon(2026, 9, 28);
  const persisted = recordHeartbeat(createState(now), {
    now,
    tabId: 9,
    active: true,
    isFocusedActiveTab: true,
  });

  const restored = recordHeartbeat(structuredClone(persisted), {
    now: now + 1_200,
    tabId: 9,
    active: true,
    isFocusedActiveTab: true,
  });

  assert.equal(restored.usedMs, 1_200);
});

test("validates limits and reports blocked state", () => {
  assert.equal(isValidLimit(1), true);
  assert.equal(isValidLimit(1_440), true);
  assert.equal(isValidLimit(0), false);
  assert.equal(isValidLimit(1.5), false);
  assert.throws(() => setLimit(createState(), 0), RangeError);

  const now = noon(2026, 9, 28);
  const state = { ...setLimit(createState(now), 1, now), usedMs: 60_000 };
  assert.equal(publicState(state, now).blocked, true);
});

test("spends one bonus for each distinct Shorts navigation", () => {
  const now = noon(2026, 9, 28);
  let state = {
    ...createState(now, 1),
    usedMs: 60_000,
    bonusRemaining: 3,
  };

  state = recordHeartbeat(state, {
    now,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
    shortId: "first",
  });
  assert.equal(state.bonusRemaining, 2);
  assert.equal(publicState(state, now).blocked, false);

  state = recordHeartbeat(state, {
    now: now + 1_000,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
    shortId: "first",
  });
  assert.equal(state.bonusRemaining, 2);

  state = recordHeartbeat(state, {
    now: now + 2_000,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
    shortId: "second",
  });
  state = recordHeartbeat(state, {
    now: now + 3_000,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
    shortId: "third",
  });
  assert.equal(state.bonusRemaining, 0);
  assert.equal(publicState(state, now + 3_000).blocked, false);

  state = recordHeartbeat(state, {
    now: now + 4_000,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
    shortId: "fourth",
  });
  assert.equal(publicState(state, now + 4_000).blocked, true);
});

test("the same Short in another tab consumes a separate bonus entry", () => {
  const now = noon(2026, 9, 28);
  let state = {
    ...createState(now, 1),
    usedMs: 60_000,
    bonusRemaining: 2,
  };
  state = recordHeartbeat(state, {
    now,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
    shortId: "same-video",
  });
  state = recordHeartbeat(state, {
    now: now + 1_000,
    tabId: 8,
    active: true,
    isFocusedActiveTab: true,
    shortId: "same-video",
  });

  assert.equal(state.bonusRemaining, 0);
  assert.equal(state.bonusTabId, 8);
});

test("leaving Shorts clears the current bonus entry", () => {
  const now = noon(2026, 9, 28);
  let state = {
    ...createState(now, 1),
    usedMs: 60_000,
    bonusRemaining: 1,
  };
  state = recordHeartbeat(state, {
    now,
    tabId: 7,
    active: true,
    isFocusedActiveTab: true,
    shortId: "current",
  });
  assert.equal(publicState(state, now).blocked, false);

  state = recordHeartbeat(state, {
    now: now + 1_000,
    tabId: 7,
    active: false,
    isFocusedActiveTab: true,
    shortId: null,
  });
  assert.equal(publicState(state, now + 1_000).blocked, true);
});
