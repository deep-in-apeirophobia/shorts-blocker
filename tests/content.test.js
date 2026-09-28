import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const contentSource = await readFile(new URL("../content.js", import.meta.url), "utf8");

class FakeClassList {
  #classes = new Set();

  add(...names) {
    names.forEach((name) => this.#classes.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.#classes.delete(name));
  }

  toggle(name, force) {
    if (force) this.#classes.add(name);
    else this.#classes.delete(name);
  }

  contains(name) {
    return this.#classes.has(name);
  }
}

function createHarness({ pathname = "/shorts/clip", focused = true, hidden = false, state } = {}) {
  const initialState = state ?? {
    day: "2026-09-28",
    usedMs: 0,
    limitMinutes: 15,
    blocked: false,
  };
  const messages = [];
  const listeners = new Map();
  const documentListeners = new Map();
  const storageListeners = [];
  const intervals = [];
  const videos = [];
  const mutations = [];
  let currentState = initialState;
  let messageHandler;
  let host;
  let ui;

  const addListener = (target, type, listener) => {
    const handlers = target.get(type) ?? [];
    handlers.push(listener);
    target.set(type, handlers);
  };

  const makeNode = (tagName = "DIV") => {
    const eventListeners = new Map();
    return {
      tagName,
      children: [],
      classList: new FakeClassList(),
      textContent: "",
      disabled: false,
      isConnected: true,
      addEventListener(type, listener) {
        addListener(eventListeners, type, listener);
      },
      appendChild(child) {
        this.children.push(child);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        return selector.startsWith("input")
          ? this.children.filter(({ tagName: childTag }) => childTag === "INPUT")
          : [];
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      focus() {
        document.activeElement = this;
      },
      dispatch(type, event = {}) {
        for (const listener of eventListeners.get(type) ?? []) listener(event);
      },
    };
  };

  const document = {
    hidden,
    hasFocus: () => focused,
    documentElement: {
      appendChild(element) {
        host = element;
        element.isConnected = true;
      },
    },
    activeElement: null,
    createElement(tagName) {
      if (tagName === "input") return makeNode("INPUT");
      const badge = makeNode();
      const badgeTime = makeNode();
      const badgeStatus = makeNode();
      const errorNote = makeNode();
      const homeLink = makeNode("A");
      const puzzleArea = makeNode();
      const puzzleGrid = makeNode();
      const puzzleMessage = makeNode();
      const checkButton = makeNode("BUTTON");
      const overlay = {
        ...makeNode(),
        querySelector(selector) {
          return selector === ".error-note" ? errorNote : null;
        },
      };
      const shadow = {
        innerHTML: "",
        querySelector(selector) {
          return {
            ".badge": badge,
            ".time": badgeTime,
            ".status": badgeStatus,
            ".overlay": overlay,
            "a": homeLink,
            ".puzzle": puzzleArea,
            ".grid": puzzleGrid,
            ".puzzle-message": puzzleMessage,
            "button": checkButton,
          }[selector] ?? null;
        },
      };
      ui = { badge, checkButton, puzzleArea, puzzleGrid, puzzleMessage };
      const element = makeNode();
      element.isConnected = false;
      element.attachShadow = () => shadow;
      element.shadow = shadow;
      return element;
    },
    querySelectorAll(selector) {
      return selector === "video" ? videos : [];
    },
    addEventListener(type, listener) {
      addListener(documentListeners, type, listener);
    },
  };

  const location = { pathname };
  const history = {
    pushState(_state, _unused, url) {
      if (url) location.pathname = new URL(url, "https://www.youtube.com").pathname;
    },
    replaceState(_state, _unused, url) {
      if (url) location.pathname = new URL(url, "https://www.youtube.com").pathname;
    },
  };

  const context = vm.createContext({
    URL,
    Error,
    Number,
    Promise,
    Set,
    String,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, respond) {
          messages.push(structuredClone(message));
          const response = messageHandler?.(message) ?? (
            message.type === "getPuzzle"
              ? { state: currentState, puzzle: { givens: Array(81).fill(0) } }
              : { state: currentState }
          );
          respond(structuredClone(response));
        },
      },
      storage: {
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
        },
      },
    },
    document,
    history,
    location,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        mutations.push(this);
      }

      observe() {}

      disconnect() {
        this.disconnected = true;
      }
    },
    addEventListener(type, listener) {
      addListener(listeners, type, listener);
    },
    clearTimeout() {},
    queueMicrotask,
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    setTimeout() {
      return 1;
    },
  });

  vm.runInContext(contentSource, context, { filename: "content.js" });

  return {
    document,
    host: () => host,
    intervals,
    messages,
    mutations,
    ui: () => ui,
    setFocused(value) {
      focused = value;
    },
    setHidden(value) {
      document.hidden = value;
    },
    setState(value) {
      currentState = value;
    },
    setMessageHandler(handler) {
      messageHandler = handler;
    },
    addVideo({ paused = false } = {}) {
      const video = {
        paused,
        pauseCalls: 0,
        pause() {
          this.pauseCalls += 1;
          this.paused = true;
        },
      };
      videos.push(video);
      return video;
    },
    async emit(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
      for (const listener of documentListeners.get(type) ?? []) listener(event);
      await settle();
    },
    async navigate(url) {
      history.pushState({}, "", url);
      await settle();
    },
    async changeStoredState(value, areaName = "local") {
      for (const listener of storageListeners) {
        listener({ shortsState: { newValue: value } }, areaName);
      }
      await settle();
    },
    async checkPuzzle() {
      ui.checkButton.dispatch("click");
      await settle();
    },
  };
}

async function settle() {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

function blockedState(overrides = {}) {
  return {
    day: "2026-09-28",
    usedMs: 60_000,
    limitMinutes: 1,
    blocked: true,
    ...overrides,
  };
}

function inputEvent(type, key) {
  return {
    type,
    key,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.propagationStopped = true;
    },
  };
}

test("leaving Shorts restores playback and scrolling", async () => {
  const browser = createHarness({ state: blockedState() });
  const video = browser.addVideo();
  await settle();

  await browser.changeStoredState(blockedState({ usedMs: 61_000 }));
  assert.equal(video.pauseCalls, 1);

  const blockedWheel = inputEvent("wheel");
  await browser.emit("wheel", blockedWheel);
  assert.equal(blockedWheel.defaultPrevented, true);

  await browser.navigate("/watch?v=abc123");
  const watchPageWheel = inputEvent("wheel");
  await browser.emit("wheel", watchPageWheel);

  assert.equal(watchPageWheel.defaultPrevented, false);
  assert.equal(browser.mutations.at(-1).disconnected, true);
});

test("reaching the limit pauses video and prevents feed navigation", async () => {
  const browser = createHarness();
  const video = browser.addVideo();
  await settle();

  await browser.changeStoredState(blockedState());
  const wheel = inputEvent("wheel");
  const touch = inputEvent("touchmove");
  const arrow = inputEvent("keydown", "ArrowDown");
  await browser.emit("wheel", wheel);
  await browser.emit("touchmove", touch);
  await browser.emit("keydown", arrow);

  assert.equal(video.pauseCalls, 1);
  assert.deepEqual(
    [wheel, touch, arrow].map((event) => [event.defaultPrevented, event.propagationStopped]),
    [[true, true], [true, true], [true, true]],
  );
});

test("heartbeats report whether Shorts are visible and focused", async () => {
  const browser = createHarness();
  await settle();

  assert.deepEqual(browser.messages.slice(0, 2), [
    { type: "getState" },
    { type: "heartbeat", active: true, shortId: "clip" },
  ]);

  browser.setFocused(false);
  await browser.emit("blur");
  browser.setFocused(true);
  browser.setHidden(true);
  await browser.emit("visibilitychange");
  browser.setHidden(false);
  await browser.emit("visibilitychange");

  assert.deepEqual(
    browser.messages.filter(({ type }) => type === "heartbeat").map(({ active }) => active),
    [true, false, false, true],
  );
  assert.equal(browser.intervals[0].delay, 1_000);
});

test("solving the displayed Sudoku grants access to Shorts", async () => {
  const browser = createHarness({ state: blockedState() });
  const solution = [
    5, 3, 4, 6, 7, 8, 9, 1, 2,
    6, 7, 2, 1, 9, 5, 3, 4, 8,
    1, 9, 8, 3, 4, 2, 5, 6, 7,
    8, 5, 9, 7, 6, 1, 4, 2, 3,
    4, 2, 6, 8, 5, 3, 7, 9, 1,
    7, 1, 3, 9, 2, 4, 8, 5, 6,
    9, 6, 1, 5, 3, 7, 2, 8, 4,
    2, 8, 7, 4, 1, 9, 6, 3, 5,
    3, 4, 5, 2, 8, 6, 1, 7, 9,
  ];
  const givens = solution.map((digit, index) => index % 4 === 0 ? digit : 0);
  browser.setMessageHandler((message) => {
    if (message.type === "getPuzzle") return { state: blockedState(), puzzle: { givens } };
    if (message.type === "solvePuzzle") {
      return {
        state: { ...blockedState(), blocked: false, bonusRemaining: 3 },
      };
    }
    return { state: blockedState() };
  });
  await browser.changeStoredState(blockedState());

  const inputs = browser.ui().puzzleGrid.querySelectorAll("input");
  assert.equal(inputs.length, 81);
  assert.equal(inputs[0].readOnly, true);
  assert.equal(inputs[1].readOnly, false);
  assert.equal(inputs[1].inputMode, "numeric");
  assert.equal(inputs[1].maxLength, 1);
  assert.equal(inputs[1]["aria-label"], "Row 1, column 2");
  inputs.forEach((input, index) => {
    if (!input.readOnly) input.value = String(solution[index]);
  });
  await browser.checkPuzzle();

  const submission = browser.messages.find(({ type }) => type === "solvePuzzle");
  assert.deepEqual(submission, { type: "solvePuzzle", solution });
  const wheel = inputEvent("wheel");
  await browser.emit("wheel", wheel);
  assert.equal(wheel.defaultPrevented, false);
  assert.equal(browser.ui().puzzleMessage.textContent, "Solved. You unlocked 3 Shorts.");
});

test("a new day's storage state removes the block", async () => {
  const browser = createHarness({ state: blockedState() });
  await settle();
  await browser.changeStoredState(blockedState());

  const beforeMidnight = inputEvent("wheel");
  await browser.emit("wheel", beforeMidnight);
  assert.equal(beforeMidnight.defaultPrevented, true);

  await browser.changeStoredState({
    day: "2026-09-29",
    usedMs: 0,
    limitMinutes: 1,
  });
  const afterMidnight = inputEvent("wheel");
  await browser.emit("wheel", afterMidnight);

  assert.equal(afterMidnight.defaultPrevented, false);
  assert.equal(browser.mutations.at(-1).disconnected, true);
});
