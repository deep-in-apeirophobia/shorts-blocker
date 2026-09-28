import {
  STORAGE_KEY,
  createState,
  normalizeState,
  publicState,
  recordHeartbeat,
  setLimit,
} from "./tracking.js";
import { generatePuzzle, isSolution } from "./sudoku.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
let operation = Promise.resolve();

function serialized(work) {
  const result = operation.then(work, work);
  operation = result.catch(() => {});
  return result;
}

async function readState(now) {
  const stored = await extensionApi.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  const state = normalizeState(raw, now);
  return { state, changed: JSON.stringify(raw) !== JSON.stringify(state) };
}

async function saveState(state) {
  await extensionApi.storage.local.set({ [STORAGE_KEY]: state });
  return state;
}

async function isSenderFocusedActiveTab(sender) {
  if (!Number.isInteger(sender.tab?.id) || sender.tab.active !== true) {
    return false;
  }

  const tabs = await extensionApi.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.some((tab) => tab.id === sender.tab.id);
}

async function handleMessage(message, sender) {
  const now = Date.now();
  const { state, changed } = await readState(now);

  if (message?.type === "getState") {
    if (changed) {
      await saveState(state);
    }
    return { state: publicState(state, now) };
  }

  if (message?.type === "setLimit") {
    const updated = setLimit(state, message.minutes, now);
    await saveState(updated);
    return { state: publicState(updated, now) };
  }

  if (message?.type === "getPuzzle") {
    if (!publicState(state, now).blocked) {
      return {
        state: publicState(state, now),
        error: "The Sudoku is available when the Shorts limit is reached.",
      };
    }
    const puzzle = state.puzzle ?? generatePuzzle();
    const updated = { ...state, puzzle };
    if (!state.puzzle) {
      await saveState(updated);
    }
    return { state: publicState(updated, now), puzzle };
  }

  if (message?.type === "solvePuzzle") {
    if (!state.puzzle || !isSolution(state.puzzle.givens, message.solution)) {
      return { state: publicState(state, now), error: "That solution is not correct." };
    }
    const updated = {
      ...state,
      bonusRemaining: 3,
      bonusShortId: null,
      bonusTabId: null,
      puzzle: null,
    };
    await saveState(updated);
    return { state: publicState(updated, now) };
  }

  if (message?.type === "heartbeat") {
    const focused = await isSenderFocusedActiveTab(sender);
    const updated = recordHeartbeat(state, {
      now,
      tabId: sender.tab?.id,
      active: message.active === true,
      isFocusedActiveTab: focused,
      shortId: typeof message.shortId === "string" ? message.shortId : null,
    });
    await saveState(updated);
    return { state: publicState(updated, now) };
  }

  throw new Error("Unknown message type.");
}

extensionApi.runtime.onInstalled.addListener(() => {
  serialized(async () => {
    const now = Date.now();
    const stored = await extensionApi.storage.local.get(STORAGE_KEY);
    if (!stored[STORAGE_KEY]) {
      await saveState(createState(now));
    }
  });
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  serialized(() => handleMessage(message, sender))
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});
