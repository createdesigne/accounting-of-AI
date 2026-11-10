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

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.source === protocol.WINDOW_READY_SOURCE
      && event.data?.type === protocol.WINDOW_READY_TYPE) {
      postPendingPayload();
      return;
    }
    if (event.data?.source !== protocol.WINDOW_ACK_SOURCE
      || event.data?.type !== protocol.WINDOW_ACK_TYPE) return;
    const validation = protocol.validatePayload(event.data.payload);
    const destination = protocol.destinationForUrl(window.location.href);
    if (!validation.ok || !destination) {
      postAcknowledgementResult(event.data?.payload?.requestId, {
        ok: false,
        message: validation.error || "許可されていない送信先です。",
      });
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "time-records:ackImported",
        destination,
        payload: event.data.payload,
      });
      postAcknowledgementResult(event.data.payload.requestId, response);
    } catch {
      postAcknowledgementResult(event.data.payload.requestId, {
        ok: false,
        message: "拡張機能へ取込完了を通知できませんでした。",
      });
    }
  });

  function postPendingPayload() {
    if (!pendingPayload) return;
    window.postMessage({
      source: protocol.WINDOW_SOURCE,
      type: protocol.WINDOW_MESSAGE_TYPE,
      payload: pendingPayload,
    }, window.location.origin);
  }

  function postAcknowledgementResult(requestId, result) {
    window.postMessage({
      source: protocol.WINDOW_ACK_RESULT_SOURCE,
      type: protocol.WINDOW_ACK_RESULT_TYPE,
      requestId,
      ok: result?.ok === true,
      message: typeof result?.message === "string" ? result.message : "",
    }, window.location.origin);
  }
})();
