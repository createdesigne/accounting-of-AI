(function initializeTimeRecordBridge() {
  "use strict";

  const protocol = globalThis.TimeRecordProtocol;
  if (!protocol || !protocol.isAllowedAppUrl(window.location.href) || !chrome.runtime?.onMessage) return;
  let pendingPayload = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "time-records:deliver") return false;
    if (!protocol.isAllowedAppUrl(window.location.href)) {
      sendResponse({ ok: false, message: "このページには利用時間を連携できません。" });
      return false;
    }
    const validation = protocol.validatePayload(message.payload);
    if (!validation.ok) {
      sendResponse({ ok: false, message: validation.error });
      return false;
    }
    pendingPayload = message.payload;
    postPendingPayload();
    sendResponse({ ok: true, recordCount: pendingPayload.records.length });
    return false;
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.source !== protocol.WINDOW_READY_SOURCE
      || event.data?.type !== protocol.WINDOW_READY_TYPE) return;
    postPendingPayload();
  });

  function postPendingPayload() {
    if (!pendingPayload) return;
    window.postMessage({
      source: protocol.WINDOW_SOURCE,
      type: protocol.WINDOW_MESSAGE_TYPE,
      payload: pendingPayload,
    }, window.location.origin);
  }
})();
