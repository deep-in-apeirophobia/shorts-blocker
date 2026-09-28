export const STORAGE_KEY = "shortsState";
export const DEFAULT_LIMIT_MINUTES = 15;
export const MAX_HEARTBEAT_INTERVAL_MS = 2_500;

export function localDay(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidLimit(minutes) {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1_440;
}

export function createState(now = Date.now(), limitMinutes = DEFAULT_LIMIT_MINUTES) {
  return {
    day: localDay(now),
    usedMs: 0,
    limitMinutes: isValidLimit(limitMinutes)
      ? limitMinutes
      : DEFAULT_LIMIT_MINUTES,
    heartbeatAt: null,
    heartbeatActive: false,
    heartbeatTabId: null,
    bonusRemaining: 0,
    bonusShortId: null,
    bonusTabId: null,
    puzzle: null,
  };
}

export function normalizeState(value, now = Date.now()) {
  const limitMinutes = isValidLimit(value?.limitMinutes)
    ? value.limitMinutes
    : DEFAULT_LIMIT_MINUTES;

  if (value?.day !== localDay(now)) {
    return createState(now, limitMinutes);
  }

  return {
    day: value.day,
    usedMs:
      Number.isFinite(value.usedMs) && value.usedMs >= 0 ? value.usedMs : 0,
    limitMinutes,
    heartbeatAt:
      Number.isFinite(value.heartbeatAt) && value.heartbeatAt <= now
        ? value.heartbeatAt
        : null,
    heartbeatActive: value.heartbeatActive === true,
    heartbeatTabId:
      Number.isInteger(value.heartbeatTabId) ? value.heartbeatTabId : null,
    bonusRemaining:
      Number.isInteger(value.bonusRemaining) && value.bonusRemaining >= 0
        ? value.bonusRemaining
        : 0,
    bonusShortId:
      typeof value.bonusShortId === "string" && value.bonusShortId
        ? value.bonusShortId
        : null,
    bonusTabId: Number.isInteger(value.bonusTabId) ? value.bonusTabId : null,
    puzzle:
      Array.isArray(value.puzzle?.givens) && value.puzzle.givens.length === 81
        ? { givens: [...value.puzzle.givens] }
        : null,
  };
}

function addPendingInterval(state, now) {
  if (!state.heartbeatActive || state.heartbeatAt === null) {
    return state;
  }

  const elapsed = Math.max(0, now - state.heartbeatAt);
  return {
    ...state,
    usedMs: state.usedMs + Math.min(elapsed, MAX_HEARTBEAT_INTERVAL_MS),
  };
}

export function recordHeartbeat(
  value,
  { now = Date.now(), tabId, active, isFocusedActiveTab, shortId = null },
) {
  let state = normalizeState(value, now);

  // Heartbeats from background tabs must not disturb the active tab's cursor.
  // A heartbeat from the tracked tab can still close its pending interval.
  const isTrackedTab = state.heartbeatTabId === tabId;
  if (!isFocusedActiveTab && !isTrackedTab) {
    return state;
  }

  state = addPendingInterval(state, now);

  state = {
    ...state,
    heartbeatAt: now,
    heartbeatActive: Boolean(active && isFocusedActiveTab),
    heartbeatTabId: isFocusedActiveTab ? tabId : null,
  };

  if (shortId === null) {
    return { ...state, bonusShortId: null, bonusTabId: null };
  }

  const atLimit = state.usedMs >= state.limitMinutes * 60_000;
  if (
    atLimit &&
    active &&
    isFocusedActiveTab &&
    typeof shortId === "string" &&
    shortId &&
    (shortId !== state.bonusShortId || tabId !== state.bonusTabId)
  ) {
    if (state.bonusRemaining > 0) {
      return {
        ...state,
        bonusRemaining: state.bonusRemaining - 1,
        bonusShortId: shortId,
        bonusTabId: tabId,
      };
    }
    return { ...state, bonusShortId: null, bonusTabId: null };
  }

  return state;
}

export function setLimit(value, minutes, now = Date.now()) {
  if (!isValidLimit(minutes)) {
    throw new RangeError("Limit must be a whole number from 1 to 1440 minutes.");
  }

  return { ...normalizeState(value, now), limitMinutes: minutes };
}

export function publicState(value, now = Date.now()) {
  const state = normalizeState(value, now);
  const atLimit = state.usedMs >= state.limitMinutes * 60_000;
  return {
    day: state.day,
    usedMs: state.usedMs,
    limitMinutes: state.limitMinutes,
    bonusRemaining: state.bonusRemaining,
    blocked: atLimit && state.bonusRemaining === 0 && state.bonusShortId === null,
  };
}
