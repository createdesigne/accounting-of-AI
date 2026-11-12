(function watchChatGptActivity() {
  "use strict";

  const MIN_SIGNAL_INTERVAL_MS = 1000;
  const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];
  const LISTENER_OPTIONS = { capture: true, passive: true };
  let lastSignalAt = 0;
  let stopped = false;

  function signalActivity() {
    const now = Date.now();
    if (now - lastSignalAt < MIN_SIGNAL_INTERVAL_MS) return;
    lastSignalAt = now;
    // Only an activity signal is sent. No text, key, page content or URL is read.
    sendMessageSafely({ type: "tracking:activity" });
  }

  function signalInactive() {
    sendMessageSafely({ type: "tracking:pageInactive" });
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") signalInactive();
  }

  function sendMessageSafely(message) {
    if (stopped) return;
    let runtime;
    try {
      runtime = globalThis.chrome?.runtime;
      if (!runtime?.id || typeof runtime.sendMessage !== "function") {
        stopWatching();
        return;
      }
      const pending = runtime.sendMessage(message);
      if (pending && typeof pending.catch === "function") {
        pending.catch((error) => {
          if (isInvalidContext(error) || !hasRuntimeContext()) stopWatching();
        });
      }
    } catch (error) {
      // An invalidated content script can throw before sendMessage returns a
      // Promise. It can never recover, so remove its page listeners.
      if (isInvalidContext(error) || !hasRuntimeContext()) stopWatching();
    }
  }

  function hasRuntimeContext() {
    try {
      return Boolean(globalThis.chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function isInvalidContext(error) {
    const detail = error && typeof error === "object" && "message" in error ? error.message : error;
    return String(detail)
      .toLowerCase().includes("extension context invalidated");
  }

  function stopWatching() {
    if (stopped) return;
    stopped = true;
    for (const eventName of ACTIVITY_EVENTS) {
      window.removeEventListener(eventName, signalActivity, LISTENER_OPTIONS);
    }
    window.removeEventListener("blur", signalInactive, LISTENER_OPTIONS);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  for (const eventName of ACTIVITY_EVENTS) {
    window.addEventListener(eventName, signalActivity, LISTENER_OPTIONS);
  }
  window.addEventListener("blur", signalInactive, LISTENER_OPTIONS);
  document.addEventListener("visibilitychange", onVisibilityChange);
})();
