(() => {
  "use strict";

  const HEARTBEAT_INTERVAL_MS = 1000;
  const MESSAGE_TIMEOUT_MS = 4000;
  const HOST_ID = "short-blocker-ui";
  const BLOCKED_KEYS = new Set([
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
    " ",
  ]);

  let state = null;
  let messageError = null;
  let heartbeatPending = false;
  let blocked = false;
  let host;
  let shadowRoot;
  let badge;
  let badgeTime;
  let badgeStatus;
  let overlay;
  let homeLink;
  let observer;
  let previousFocus;
  let puzzleArea;
  let puzzleGrid;
  let puzzleMessage;
  let checkButton;
  let puzzleLoading = false;
  let puzzleLoaded = false;
  let puzzleNextRetryAt = 0;

  function isShortsRoute() {
    return /^\/shorts(?:\/|$)/.test(location.pathname);
  }

  function isActive() {
    return isShortsRoute() && !blocked && !document.hidden && document.hasFocus();
  }

  function currentShortId() {
    const match = location.pathname.match(/^\/shorts\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function formatRemaining(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function remainingMs() {
    if (!state || !Number.isFinite(Number(state.limitMinutes))) return null;
    return Math.max(
      0,
      Number(state.limitMinutes) * 60 * 1000 - Number(state.usedMs || 0),
    );
  }

  function ensureUi() {
    if (host?.isConnected) return true;
    if (!document.documentElement) return false;

    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("aria-live", "polite");
    const shadow = host.attachShadow({ mode: "closed" });
    shadowRoot = shadow;
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          color-scheme: dark;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .badge {
          position: fixed;
          top: 76px;
          right: 18px;
          z-index: 2147483646;
          display: none;
          align-items: center;
          gap: 7px;
          padding: 7px 10px;
          color: #f4f7ea;
          background: rgba(23, 25, 23, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(12px);
          font-size: 12px;
          font-weight: 500;
          line-height: 1.2;
          pointer-events: none;
        }
        .badge.visible { display: flex; }
        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #d6ed98;
          box-shadow: 0 0 0 3px rgba(214, 237, 152, 0.13);
        }
        .badge.error .dot {
          background: #ffb454;
          box-shadow: 0 0 0 3px rgba(255, 180, 84, 0.13);
        }
        .status { color: #aaaab3; }
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: none;
          place-items: center;
          box-sizing: border-box;
          padding: 24px;
          overflow: auto;
          color: #f4f7ea;
          background:
            radial-gradient(circle at 50% 18%, rgba(214, 237, 152, 0.15), transparent 34%),
            linear-gradient(145deg, #111311, #1b1e1a 62%, #111311);
        }
        .overlay.visible { display: grid; }
        .card {
          width: min(460px, 100%);
          box-sizing: border-box;
          padding: 42px 38px 38px;
          text-align: center;
          background: rgba(23, 25, 23, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.11);
          border-radius: 24px;
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(18px);
        }
        .icon {
          display: grid;
          place-items: center;
          width: 54px;
          height: 54px;
          margin: 0 auto 22px;
          color: #d6ed98;
          background: rgba(214, 237, 152, 0.1);
          border: 1px solid rgba(214, 237, 152, 0.25);
          border-radius: 18px;
          font-size: 23px;
          font-weight: 600;
          line-height: 1;
        }
        h1 { margin: 0 0 12px; font-size: 28px; font-weight: 650; line-height: 1.2; letter-spacing: -0.02em; }
        p { margin: 0 auto 28px; max-width: 350px; color: #bdc3b4; font-size: 15px; line-height: 1.6; }
        a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          padding: 0 20px;
          color: #171917;
          background: #d6ed98;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 650;
          line-height: 1;
          text-decoration: none;
          transition: transform 120ms ease, background 120ms ease;
        }
        a:hover { background: #e3f7ab; transform: translateY(-1px); }
        a:focus-visible { outline: 3px solid #d6ed98; outline-offset: 3px; }
        .error-note { display: none; margin-top: 18px; color: #e5ad67; font-size: 12px; line-height: 1.4; }
        .error-note.visible { display: block; }
        .puzzle { display: none; margin: 24px auto 0; }
        .puzzle.visible { display: block; }
        .grid { display: grid; grid-template-columns: repeat(9, 34px); justify-content: center; width: max-content; margin: 0 auto 18px; border: 2px solid #d6ed98; background: #41483b; gap: 1px; }
        .cell { width: 34px; height: 34px; box-sizing: border-box; padding: 0; border: 0; color: #f4f7ea; background: #242824; text-align: center; font: 600 16px/1 system-ui, sans-serif; appearance: textfield; }
        .cell:nth-child(3n) { margin-right: 1px; }
        .cell:nth-child(9n) { margin-right: 0; }
        .cell:nth-child(n+19):nth-child(-n+27), .cell:nth-child(n+46):nth-child(-n+54) { margin-bottom: 1px; }
        .cell.given { color: #d6ed98; background: #1d201d; }
        .cell:focus { outline: 2px solid #d6ed98; outline-offset: -2px; }
        .puzzle-message { min-height: 18px; margin: 0 0 12px; color: #bdc3b4; font-size: 12px; }
        button { min-height: 40px; padding: 0 18px; border: 0; border-radius: 10px; color: #171917; background: #d6ed98; font: 650 14px/1 system-ui, sans-serif; cursor: pointer; }
        button:disabled { cursor: wait; opacity: .55; }
      </style>
      <div class="badge" role="status">
        <span class="dot"></span>
        <span class="time"></span>
        <span class="status"></span>
      </div>
      <section class="overlay" role="dialog" aria-modal="true" aria-labelledby="short-blocker-title">
        <div class="card">
          <div class="icon" aria-hidden="true">Ⅱ</div>
          <h1 id="short-blocker-title">That's enough Shorts for today</h1>
          <p>Your daily time is up. Shorts reset at midnight.</p>
          <a href="https://www.youtube.com/">Go to YouTube home</a>
          <div class="puzzle">
            <div class="grid" role="group" aria-label="Sudoku puzzle"></div>
            <div class="puzzle-message" role="status"></div>
            <button type="button">Check solution</button>
          </div>
          <div class="error-note">The timer is temporarily unavailable. This page will retry automatically.</div>
        </div>
      </section>
    `;

    badge = shadow.querySelector(".badge");
    badgeTime = shadow.querySelector(".time");
    badgeStatus = shadow.querySelector(".status");
    overlay = shadow.querySelector(".overlay");
    homeLink = shadow.querySelector("a");
    puzzleArea = shadow.querySelector(".puzzle");
    puzzleGrid = shadow.querySelector(".grid");
    puzzleMessage = shadow.querySelector(".puzzle-message");
    checkButton = shadow.querySelector("button");
    checkButton?.addEventListener("click", submitPuzzle);
    document.documentElement.appendChild(host);
    return true;
  }

  function pauseVideos() {
    document.querySelectorAll("video").forEach((video) => {
      if (!video.paused) video.pause();
    });
  }

  function preventBlockedInteraction(event) {
    if (!blocked) return;
    if ((event.type === "wheel" || event.type === "touchmove") && event.target === host) return;
    if (event.type === "keydown" && !BLOCKED_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handlePlay(event) {
    if (blocked && event.target?.tagName === "VIDEO") event.target.pause();
  }

  function trapFocus(event) {
    if (!blocked || event.key !== "Tab") return;
    const controls = [homeLink, ...(puzzleGrid?.querySelectorAll("input:not([readonly])") || []), checkButton]
      .filter((element) => element && !element.disabled);
    if (!controls.length) return;
    const index = controls.indexOf(shadowRoot?.activeElement);
    const nextIndex = event.shiftKey
      ? (index <= 0 ? controls.length - 1 : index - 1)
      : (index < 0 || index === controls.length - 1 ? 0 : index + 1);
    event.preventDefault();
    event.stopImmediatePropagation();
    controls[nextIndex].focus();
  }

  function showPuzzle(givens) {
    if (!Array.isArray(givens) || givens.length !== 81) throw new Error("The puzzle is unavailable.");
    puzzleGrid.replaceChildren();
    givens.forEach((given, index) => {
      const input = document.createElement("input");
      input.className = `cell${given ? " given" : ""}`;
      input.type = "text";
      input.inputMode = "numeric";
      input.maxLength = 1;
      input.value = given ? String(given) : "";
      input.readOnly = Boolean(given);
      input.setAttribute("aria-label", `Row ${Math.floor(index / 9) + 1}, column ${(index % 9) + 1}`);
      input.addEventListener("input", () => {
        input.value = input.value.replace(/[^1-9]/g, "").slice(-1);
        puzzleMessage.textContent = "";
      });
      puzzleGrid.appendChild(input);
    });
    puzzleLoaded = true;
    puzzleArea.classList.add("visible");
    puzzleMessage.textContent = "Solve this hard Sudoku to unlock 3 Shorts.";
  }

  async function loadPuzzle(force = false) {
    if (puzzleLoading || puzzleLoaded) return;
    if (!force && Date.now() < puzzleNextRetryAt) return;
    if (!puzzleArea || !puzzleGrid || !puzzleMessage || !checkButton) return;
    puzzleLoading = true;
    puzzleArea?.classList.add("visible");
    if (puzzleMessage) puzzleMessage.textContent = "Loading puzzle...";
    try {
      const response = await sendMessage({ type: "getPuzzle" });
      showPuzzle(response.puzzle?.givens);
      puzzleNextRetryAt = 0;
      checkButton.textContent = "Check solution";
    } catch (error) {
      puzzleNextRetryAt = Date.now() + 5000;
      puzzleMessage.textContent = error instanceof Error ? error.message : String(error);
      checkButton.textContent = "Retry";
    } finally {
      puzzleLoading = false;
    }
  }

  async function submitPuzzle() {
    if (!puzzleLoaded) {
      puzzleNextRetryAt = 0;
      await loadPuzzle(true);
      return;
    }
    const solution = [...puzzleGrid.querySelectorAll("input")].map((input) => Number(input.value));
    if (solution.some((value) => value < 1 || value > 9)) {
      puzzleMessage.textContent = "Fill every square before checking.";
      return;
    }
    checkButton.disabled = true;
    puzzleMessage.textContent = "Checking...";
    try {
      const response = await sendMessage({ type: "solvePuzzle", solution });
      acceptResponse(response);
      if (response.state?.blocked) {
        puzzleMessage.textContent = "That solution isn't right yet.";
      } else {
        puzzleMessage.textContent = "Solved. You unlocked 3 Shorts.";
      }
    } catch (error) {
      puzzleMessage.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      checkButton.disabled = false;
    }
  }

  function setBlocked(nextBlocked) {
    if (blocked === nextBlocked) {
      if (blocked) {
        pauseVideos();
        loadPuzzle();
      }
      return;
    }

    blocked = nextBlocked;
    if (blocked) {
      previousFocus = document.activeElement;
      pauseVideos();
      observer = new MutationObserver(pauseVideos);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      queueMicrotask(() => homeLink?.focus());
      loadPuzzle();
    } else {
      observer?.disconnect();
      observer = undefined;
      if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
      previousFocus = undefined;
      puzzleLoaded = false;
      puzzleNextRetryAt = 0;
      puzzleGrid?.replaceChildren();
      puzzleArea?.classList.remove("visible");
    }
  }

  function render() {
    if (!ensureUi()) return;
    const onShorts = isShortsRoute();
    const shouldBlock = onShorts && Boolean(state?.blocked);
    setBlocked(shouldBlock);

    overlay.classList.toggle("visible", shouldBlock);
    overlay.querySelector(".error-note").classList.toggle("visible", shouldBlock && Boolean(messageError));

    const showBadge = onShorts && !shouldBlock;
    badge.classList.toggle("visible", showBadge);
    badge.classList.toggle("error", Boolean(messageError));

    if (showBadge && messageError) {
      badgeTime.textContent = "Timer unavailable";
      badgeStatus.textContent = "Retrying";
    } else if (showBadge) {
      const remaining = remainingMs();
      const hasBonus = remaining === 0 && !state?.blocked;
      badgeTime.textContent = hasBonus
        ? Number(state?.bonusRemaining) > 0
          ? `${state.bonusRemaining} bonus Short${state.bonusRemaining === 1 ? "" : "s"}`
          : "Final bonus Short"
        : remaining === null ? "Checking timer" : `${formatRemaining(remaining)} left`;
      badgeStatus.textContent = isActive() ? "" : "Paused";
    }
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("The extension did not respond."));
      }, MESSAGE_TIMEOUT_MS);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
          } else if (!response) {
            reject(new Error("The extension returned no state."));
          } else if (response.error) {
            reject(new Error(String(response.error)));
          } else {
            resolve(response);
          }
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  function acceptResponse(response) {
    if (response?.state && typeof response.state === "object") {
      state = response.state;
      messageError = null;
    }
    render();
  }

  async function requestState() {
    try {
      acceptResponse(await sendMessage({ type: "getState" }));
    } catch (error) {
      messageError = error instanceof Error ? error.message : String(error);
      render();
    }
  }

  async function heartbeat() {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try {
      acceptResponse(await sendMessage({
        type: "heartbeat",
        active: isActive(),
        shortId: isShortsRoute() ? currentShortId() : null,
      }));
    } catch (error) {
      messageError = error instanceof Error ? error.message : String(error);
      render();
    } finally {
      heartbeatPending = false;
    }
  }

  function handleNavigation() {
    render();
    requestState();
    heartbeat();
  }

  function wrapHistoryMethod(methodName) {
    const original = history[methodName];
    history[methodName] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(handleNavigation);
      return result;
    };
  }

  ensureUi();
  render();
  requestState();
  heartbeat();
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  }
  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  addEventListener("popstate", handleNavigation);
  addEventListener("yt-navigate-finish", handleNavigation);
  document.addEventListener("visibilitychange", () => {
    render();
    heartbeat();
  });
  addEventListener("focus", heartbeat);
  addEventListener("blur", heartbeat);

  addEventListener("wheel", preventBlockedInteraction, { capture: true, passive: false });
  addEventListener("touchmove", preventBlockedInteraction, { capture: true, passive: false });
  addEventListener("keydown", preventBlockedInteraction, true);
  addEventListener("keydown", trapFocus, true);
  document.addEventListener("play", handlePlay, true);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !("shortsState" in changes)) return;
    const storedState = changes.shortsState.newValue;
    if (storedState && typeof storedState === "object") {
      const limitMinutes = Number(storedState.limitMinutes);
      const usedMs = Number(storedState.usedMs || 0);
      const bonusRemaining = Number(storedState.bonusRemaining || 0);
      state = {
        day: storedState.day,
        usedMs,
        limitMinutes,
        bonusRemaining,
        blocked:
          Number.isFinite(limitMinutes) &&
          limitMinutes > 0 &&
          usedMs >= limitMinutes * 60 * 1000 &&
          bonusRemaining === 0 &&
          !storedState.bonusShortId,
      };
      messageError = null;
      render();
    }
  });
})();
