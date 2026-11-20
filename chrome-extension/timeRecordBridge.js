(function initializeTimeRecordBridge() {
  "use strict";

  const BRIDGE_INSTANCE_KEY = "__aiThoughtReceiptTimeRecordBridgeV1";
  const protocol = globalThis.TimeRecordProtocol;
  if (!protocol || !protocol.isAllowedAppUrl(window.location.href) || !chrome.runtime?.onMessage) return;
  if (globalThis[BRIDGE_INSTANCE_KEY]) return;
  globalThis[BRIDGE_INSTANCE_KEY] = true;
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
      && event.data?.type === protocol.WINDOW_AUTO_REQUEST_TYPE) {
      await requestAutomaticRecords(event.data.requestId);
      return;
    }
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
      const response = await sendRuntimeAcknowledgement({
        type: "time-records:ackImported",
        destination,
        payload: event.data.payload,
      });
      postAcknowledgementResult(event.data.payload.requestId, response);
    } catch (error) {
      postAcknowledgementResult(event.data.payload.requestId, {
        ok: false,
        message: error instanceof Error
          ? `拡張機能へ取込完了を通知できませんでした（Service Worker通信: ${safeErrorMessage(error)}）。`
          : "拡張機能へ取込完了を通知できませんでした（Service Worker通信）。",
      });
    }
  });

  async function sendRuntimeAcknowledgement(message) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await chrome.runtime.sendMessage(message);
        if (response?.ok === true) return response;
        lastError = new Error(
          typeof response?.message === "string" && response.message
            ? response.message
            : "Service Workerから応答がありません。",
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Service Workerとの通信に失敗しました。");
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw lastError ?? new Error("Service Workerとの通信に失敗しました。");
  }

  function safeErrorMessage(error) {
    const value = typeof error?.message === "string" ? error.message : "不明なエラー";
    return value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").slice(0, 240);
  }

  function postPendingPayload() {
    if (!pendingPayload) return;
    window.postMessage({
      source: protocol.WINDOW_SOURCE,
      type: protocol.WINDOW_MESSAGE_TYPE,
      payload: pendingPayload,
    }, window.location.origin);
  }

  async function requestAutomaticRecords(requestId) {
    if (!protocol.isValidRequestId(requestId)) return;
    const destination = protocol.destinationForUrl(window.location.href);
    if (!destination) {
      postAutomaticResult(requestId, { ok: false, message: "許可されていない送信先です。" });
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "time-records:getFinalized",
        destination,
      });
      const validation = protocol.validatePayload(response?.payload);
      if (!response?.ok || !validation.ok) {
        throw new Error(response?.message || validation.error || "利用時間を取得できませんでした。");
      }
      postAutomaticResult(requestId, { ok: true, payload: response.payload });
    } catch (error) {
      postAutomaticResult(requestId, {
        ok: false,
        message: error instanceof Error ? error.message : "利用時間を取得できませんでした。",
      });
    }
  }

  function postAutomaticResult(requestId, result) {
    window.postMessage({
      source: protocol.WINDOW_SOURCE,
      type: protocol.WINDOW_AUTO_RESULT_TYPE,
      requestId,
      ok: result.ok === true,
      payload: result.ok === true ? result.payload : undefined,
      message: result.ok === true ? "" : result.message,
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
