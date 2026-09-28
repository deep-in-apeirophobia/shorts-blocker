import assert from "node:assert/strict";
import test from "node:test";

import { createState, STORAGE_KEY } from "../tracking.js";

function createChromeMock(initialState) {
  const listeners = [];
  const stored = { [STORAGE_KEY]: structuredClone(initialState) };
  let writes = 0;

  return {
    chrome: {
      runtime: {
        lastError: undefined,
        onInstalled: { addListener() {} },
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
      storage: {
        local: {
          async get(key) {
            await Promise.resolve();
            return { [key]: structuredClone(stored[key]) };
          },
          async set(update) {
            await Promise.resolve();
            Object.assign(stored, structuredClone(update));
            writes += 1;
          },
        },
      },
      tabs: {
        async query() {
          return [{ id: 7, active: true }];
        },
      },
    },
    latestListener() {
      return listeners.at(-1);
    },
    stored,
    writeCount() {
      return writes;
    },
  };
}

function send(listener, message, sender = { tab: { id: 7, active: true } }) {
  return new Promise((resolve, reject) => {
    const keepChannelOpen = listener(message, sender, resolve);
    if (keepChannelOpen !== true) {
      reject(new Error("Background listener did not keep the response channel open."));
    }
  });
}

test("serializes concurrent heartbeats and resumes from persisted state after reload", async () => {
  const realNow = Date.now;
  const start = new Date(2026, 8, 28, 12).getTime();
  const mock = createChromeMock({
    ...createState(start),
    heartbeatAt: start,
    heartbeatActive: true,
    heartbeatTabId: 7,
  });
  globalThis.chrome = mock.chrome;

  try {
    const times = [start + 1_000, start + 2_000];
    Date.now = () => times.shift() ?? start + 2_000;
    await import(`../background.js?initial=${start}`);

    const listener = mock.latestListener();
    const [first, second] = await Promise.all([
      send(listener, { type: "heartbeat", active: true }),
      send(listener, { type: "heartbeat", active: true }),
    ]);

    assert.equal(first.state.usedMs, 1_000);
    assert.equal(second.state.usedMs, 2_000);
    assert.equal(mock.stored[STORAGE_KEY].usedMs, 2_000);

    Date.now = () => start + 3_000;
    await import(`../background.js?reload=${start}`);
    const afterReload = await send(mock.latestListener(), {
      type: "heartbeat",
      active: true,
    });

    assert.equal(afterReload.state.usedMs, 3_000);
    assert.equal(mock.stored[STORAGE_KEY].usedMs, 3_000);

    const writesBeforeGet = mock.writeCount();
    await send(mock.latestListener(), { type: "getState" }, {});
    assert.equal(mock.writeCount(), writesBeforeGet);

    const solution = [
      1, 2, 3, 4, 5, 6, 7, 8, 9,
      4, 5, 6, 7, 8, 9, 1, 2, 3,
      7, 8, 9, 1, 2, 3, 4, 5, 6,
      2, 3, 4, 5, 6, 7, 8, 9, 1,
      5, 6, 7, 8, 9, 1, 2, 3, 4,
      8, 9, 1, 2, 3, 4, 5, 6, 7,
      3, 4, 5, 6, 7, 8, 9, 1, 2,
      6, 7, 8, 9, 1, 2, 3, 4, 5,
      9, 1, 2, 3, 4, 5, 6, 7, 8,
    ];
    Object.assign(mock.stored[STORAGE_KEY], {
      usedMs: 15 * 60_000,
      puzzle: { givens: Array(81).fill(0) },
    });
    const solved = await send(mock.latestListener(), {
      type: "solvePuzzle",
      solution,
    });
    assert.equal(solved.state.bonusRemaining, 3);
    assert.equal(solved.state.blocked, false);
    assert.equal(mock.stored[STORAGE_KEY].puzzle, null);

    const replay = await send(mock.latestListener(), {
      type: "solvePuzzle",
      solution,
    });
    assert.match(replay.error, /not correct/i);
    assert.equal(replay.state.bonusRemaining, 3);
  } finally {
    Date.now = realNow;
    delete globalThis.chrome;
  }
});
