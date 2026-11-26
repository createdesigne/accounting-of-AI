const WEB_APP_URLS = {
  production: "https://accounting-of-ai.vercel.app/accounting-of-AI/",
  researchPreview: "https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/accounting-of-AI/",
  legacy: "https://createdesigne.github.io/accounting-of-AI/",
  preview: "https://createdesigne.github.io/accounting-of-AI/preview/month-ledger/",
  local: "http://localhost:5173/accounting-of-AI/",
  research: "http://localhost:5174/accounting-of-AI/",
};
const DESTINATION_STORAGE_KEY = "selectedWebAppDestinationV1";
const ALLOWED_DESTINATIONS = new Set(Object.keys(WEB_APP_URLS));
const HOST_PERMISSION_BY_DESTINATION = Object.freeze({
  researchPreview: "https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/*",
  research: "http://localhost:5174/*",
});
const timeRecordProtocol = globalThis.TimeRecordProtocol;

const button = document.getElementById("createReceipt");
const statusText = document.getElementById("status");
const destination = document.getElementById("destination");
const advancedDestinations = document.getElementById("advancedDestinations");
const advancedDestinationOptions = document.getElementById("advancedDestinationOptions");
function syncAdvancedDestinationOptions() {
  if (advancedDestinationOptions) advancedDestinationOptions.hidden = !advancedDestinations?.open;
}
advancedDestinations?.addEventListener?.("toggle", syncAdvancedDestinationOptions);
syncAdvancedDestinationOptions();
const destinationReady = restoreDestination();
destination?.addEventListener?.("change", persistDestination);
const extensionVersion = globalThis.chrome?.runtime?.getManifest?.().version || "不明";
const versionText = document.getElementById("version");
if (versionText) versionText.textContent = `バージョン ${extensionVersion}`;

const trackingStart = document.getElementById("trackingStart");
const trackingStop = document.getElementById("trackingStop");
const trackingStatus = document.getElementById("trackingStatus");
const trackingSessionTime = document.getElementById("trackingSessionTime");
const trackingFinalizedTime = document.getElementById("trackingFinalizedTime");
const timeLedgerTransfer = document.getElementById("timeLedgerTransfer");
const timeTransferStatus = document.getElementById("timeTransferStatus");
const timeManualCopy = document.getElementById("timeManualCopy");
const timeTransferText = document.getElementById("timeTransferText");
const conversationDiagnostic = document.getElementById("conversationDiagnostic");
const diagnosticStatus = document.getElementById("diagnosticStatus");

if (trackingStart && trackingStop && trackingStatus && chrome.runtime?.sendMessage) {
  trackingStart.addEventListener("click", () => updateTracking(true));
  trackingStop.addEventListener("click", () => updateTracking(false));
  refreshTracking();
  if (typeof setInterval === "function") {
    const refreshTimer = setInterval(refreshTracking, 1000);
    globalThis.addEventListener?.("unload", () => clearInterval(refreshTimer), { once: true });
  }
}

if (timeLedgerTransfer && timeTransferStatus && timeRecordProtocol && chrome.runtime?.sendMessage) {
  timeLedgerTransfer.addEventListener("click", transferFinalizedTimeRecords);
}

if (timeManualCopy && timeTransferStatus && timeTransferText && timeRecordProtocol && chrome.runtime?.sendMessage) {
  timeManualCopy.addEventListener("click", copyFinalizedTimeRecords);
}

if (conversationDiagnostic && diagnosticStatus) {
  conversationDiagnostic.addEventListener("click", runConversationDiagnostic);
}

button.addEventListener("click", async () => {
  setStatus("会話を読み取っています...", true);

  try {
    await destinationReady;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error("現在のタブを取得できませんでした。");
    }

    if (inferAiService(tab.url) === "その他") {
      throw new Error("ChatGPT・Claude・Geminiなど、対応するAIの会話ページで実行してください。");
    }
    // Snapshot the tracker before reading the DOM. Conversation extraction can
    // take a moment while the page hydrates, and the person may stop tracking
    // immediately after pressing the button. Keep only an exact, unambiguous
    // session identifier; never infer a match from time or tab information.
    const trackingBeforeCapture = await getTrackingSnapshot();
    const [extracted] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractConversationFromPage,
    });

    const rawConversation = normalizeConversation(extracted?.result, tab);
    rawConversation.captureId = createCaptureId();
    const trackingAfterCapture = await getTrackingSnapshot();
    const measurementSessionId = resolveCaptureMeasurementSession(
      trackingBeforeCapture,
      trackingAfterCapture,
    );
    // This is an exact tracker identifier, not a date/title-based guess. The app still asks
    // the person to confirm the matching finalized measurement before saving an activity.
    if (measurementSessionId) rawConversation.measurementSessionId = measurementSessionId;
    const url = new URL(WEB_APP_URLS[destination.value] || WEB_APP_URLS.production);
    // A fragment is read by the app; conversation text is not sent to the server in the HTTP URL.
    url.hash = new URLSearchParams({ draft: JSON.stringify(rawConversation) }).toString();
    if (url.href.length > 1500000) throw new Error("会話が長すぎるため送れません。短い会話でお試しください。");

    const opened = await chrome.tabs.create({
      url: url.href,
      ...(destination.value === "researchPreview" ? { active: false } : {}),
    });
    if (destination.value === "researchPreview" && opened?.id) {
      try {
        await waitForPreviewConversationDestination(opened.id);
      } catch (error) {
        await chrome.tabs.update?.(opened.id, { active: true });
        throw error;
      }
      await chrome.tabs.update?.(opened.id, { active: true });
    }
    setStatus("Webアプリを開きました。", false);
  } catch (error) {
    console.error(error);
    setStatus(formatAccessError(error, "会話データを送れませんでした。"), false);
  }
});

function createCaptureId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid) return `capture-${uuid}`;
  return `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

async function waitForPreviewConversationDestination(tabId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = typeof tab?.url === "string" && tab.url
      ? tab.url
      : typeof tab?.pendingUrl === "string" ? tab.pendingUrl : "";
    if (isVercelAuthenticationUrl(currentUrl)) {
      throw new Error("VERCEL_PREVIEW_AUTH_REQUIRED");
    }
    if (isSelectedWebAppUrl(currentUrl, "researchPreview") && tab?.status !== "loading") return;
    if (currentUrl && tab?.status !== "loading" && !isSelectedWebAppUrl(currentUrl, "researchPreview")) {
      throw new Error("研究用Vercel Previewとは異なるページへ移動しました。Previewを開いて認証後、会話ページから再送してください。");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("研究用Vercel Previewの読み込みが完了しませんでした。Previewを開いて認証状態を確認してください。");
}

function isSelectedWebAppUrl(value, destinationName) {
  try {
    const actual = new URL(value);
    const expected = new URL(WEB_APP_URLS[destinationName]);
    return actual.origin === expected.origin && actual.pathname.startsWith(expected.pathname);
  } catch {
    return false;
  }
}

function isVercelAuthenticationUrl(value) {
  try {
    const url = new URL(value);
    return (url.hostname === "vercel.com" || url.hostname === "www.vercel.com")
      && (url.pathname.startsWith("/login") || url.pathname.startsWith("/sso-api") || url.pathname.startsWith("/api/auth"));
  } catch {
    return false;
  }
}

async function getTrackingSnapshot() {
  try {
    const state = await chrome.runtime?.sendMessage?.({ type: "tracking:get" });
    return state?.ok ? state : null;
  } catch {
    return null;
  }
}

function resolveCaptureMeasurementSession(before, after) {
  const beforeId = typeof before?.currentSessionId === "string" && before.currentSessionId
    ? before.currentSessionId
    : null;
  const afterId = typeof after?.currentSessionId === "string" && after.currentSessionId
    ? after.currentSessionId
    : null;
  if (beforeId && afterId && beforeId !== afterId) return null;
  return beforeId || afterId;
}

function setStatus(message, busy) {
  statusText.textContent = message;
  button.disabled = busy;
  destination.disabled = busy;
}

async function refreshTracking() {
  if (refreshTracking.pending) return;
  refreshTracking.pending = true;
  try {
    await sendTrackingMessage({ type: "tracking:get" });
  } finally {
    refreshTracking.pending = false;
  }
}

async function updateTracking(enabled) {
  trackingStart.disabled = true;
  trackingStop.disabled = true;
  trackingStatus.textContent = enabled ? "計測を開始しています…" : "計測を停止しています…";
  await sendTrackingMessage({ type: "tracking:setEnabled", enabled });
}

async function sendTrackingMessage(message) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.message || "計測状態を確認できませんでした。");
    renderTracking(result);
    if (result.watcherIssue?.message && result.enabled) {
      trackingStatus.textContent = result.watcherIssue.message;
    }
  } catch (error) {
    trackingStatus.textContent = error instanceof Error ? error.message : "計測状態を確認できませんでした。";
    trackingStart.disabled = false;
    trackingStop.disabled = false;
  }
}

function renderTracking(state) {
  trackingStart.disabled = state.enabled;
  trackingStop.disabled = !state.enabled;
  const session = formatDuration(state.sessionSeconds);
  const finalized = formatDuration(state.finalizedSeconds);
  if (trackingSessionTime) trackingSessionTime.textContent = session;
  if (trackingFinalizedTime) trackingFinalizedTime.textContent = finalized;
  if (!state.enabled) {
    trackingStatus.textContent = "停止中 · 計測を始めると時間が記録されます";
  } else if (state.active) {
    trackingStatus.textContent = "計測中 · ChatGPTを操作している時間を記録";
  } else {
    trackingStatus.textContent = "待機中 · ChatGPTを操作すると計測を再開";
  }
}

async function transferFinalizedTimeRecords() {
  timeLedgerTransfer.disabled = true;
  timeTransferStatus.textContent = "確定済みの利用時間を準備しています…";
  try {
    await destinationReady;
    const destinationName = destination.value;
    const response = await chrome.runtime.sendMessage({
      type: "time-records:getFinalized",
      destination: destinationName,
    });
    if (!response?.ok) throw new Error(response?.message || "利用時間を準備できませんでした。");
    const validation = timeRecordProtocol.validatePayload(response.payload);
    if (!validation.ok) throw new Error(validation.error);
    if (response.payload.records.length === 0) {
      timeTransferStatus.textContent = "連携できる確定済みの利用時間はまだありません。";
      return;
    }

    const targetUrl = timeRecordProtocol.DESTINATIONS[destinationName];
    if (!targetUrl || !timeRecordProtocol.isAllowedAppUrl(targetUrl)) {
      throw new Error("許可されていない送信先です。");
    }
    const targetTab = await findOrCreateTimeDestination(destinationName, targetUrl);
    const targetAccess = await waitForTimeDestination(targetTab.id, destinationName);
    await deliverTimePayload(targetTab.id, response.payload, destinationName, targetAccess);
    timeTransferStatus.textContent = `${response.payload.records.length}件の利用時間を確認画面へ渡しました。まだ帳簿には保存されていません。`;
    if (chrome.tabs.update) await chrome.tabs.update(targetTab.id, { active: true });
  } catch (error) {
    console.error(error);
    timeTransferStatus.textContent = formatTimeTransferError(error);
  } finally {
    timeLedgerTransfer.disabled = false;
  }
}

async function copyFinalizedTimeRecords() {
  timeManualCopy.disabled = true;
  timeTransferStatus.textContent = "確定済みの実測記録を準備しています…";
  try {
    await destinationReady;
    const response = await chrome.runtime.sendMessage({
      type: "time-records:getFinalized",
      destination: destination.value,
    });
    if (!response?.ok) throw new Error(response?.message || "利用時間を準備できませんでした。");
    const validation = timeRecordProtocol.validatePayload(response.payload);
    if (!validation.ok) throw new Error(validation.error);
    if (response.payload.records.length === 0) {
      timeTransferText.value = "";
      timeTransferText.hidden = true;
      timeTransferStatus.textContent = "コピーできる確定済みの利用時間はまだありません。";
      return;
    }
    const serialized = JSON.stringify(response.payload);
    timeTransferText.value = serialized;
    let copied = false;
    try {
      await navigator.clipboard?.writeText?.(serialized);
      copied = true;
    } catch {
      copied = false;
    }
    if (!copied) {
      timeTransferText.hidden = false;
      timeTransferText.focus?.();
      timeTransferText.select?.();
      try { copied = document.execCommand?.("copy") === true; } catch { copied = false; }
    }
    timeTransferText.hidden = copied;
    timeTransferStatus.textContent = copied
      ? `${response.payload.records.length}件の実測記録をコピーしました。アプリの「手動連携」に貼り付けて内容を確認してください。元の計測記録は保持されています。`
      : "自動コピーできませんでした。下の手動連携用データを選択してコピーしてください。元の計測記録は保持されています。";
  } catch (error) {
    timeTransferStatus.textContent = error instanceof Error ? error.message : "実測記録をコピーできませんでした。";
  } finally {
    timeManualCopy.disabled = false;
  }
}

async function restoreDestination() {
  try {
    const stored = await chrome.storage?.local?.get?.(DESTINATION_STORAGE_KEY);
    const value = stored?.[DESTINATION_STORAGE_KEY];
    if (destination && ALLOWED_DESTINATIONS.has(value)) {
      destination.value = value;
      if (!["production", "researchPreview"].includes(value) && advancedDestinations) {
        advancedDestinations.open = true;
        syncAdvancedDestinationOptions();
      }
    }
  } catch (error) {
    console.error("送信先を復元できませんでした。", error);
  }
}

async function persistDestination() {
  const value = destination?.value;
  if (!ALLOWED_DESTINATIONS.has(value)) return;
  try {
    await chrome.storage?.local?.set?.({ [DESTINATION_STORAGE_KEY]: value });
  } catch (error) {
    console.error("送信先を保存できませんでした。", error);
  }
}

async function findOrCreateTimeDestination(destinationName, targetUrl) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && activeTab.url
    && timeRecordProtocol.isDestinationUrl(activeTab.url, destinationName)) {
    return activeTab;
  }
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.id && tab.url
    && timeRecordProtocol.isDestinationUrl(tab.url, destinationName));
  if (existing) return existing;
  const created = await chrome.tabs.create({ url: targetUrl, active: false });
  if (!created?.id || (created.url && !timeRecordProtocol.isDestinationUrl(created.url, destinationName))) {
    throw new Error("連携先のWebアプリを開けませんでした。");
  }
  return created;
}

async function waitForTimeDestination(tabId, destinationName) {
  let lastAccess = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    lastAccess = await inspectTimeDestination(tabId, destinationName);
    if (lastAccess.urlMatches && lastAccess.status !== "loading") return lastAccess;
    if (isVercelAuthenticationUrl(lastAccess.url)) {
      await chrome.tabs.update?.(tabId, { active: true });
      throw timeDeliveryError("preview-authentication", lastAccess, "VERCEL_PREVIEW_AUTH_REQUIRED");
    }
    if (lastAccess.url && !lastAccess.urlMatches && lastAccess.status !== "loading") {
      throw timeDeliveryError("target-url", lastAccess, "選択した送信先とは異なるURLのタブです。");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw timeDeliveryError("target-loading", lastAccess, "送信先タブの読み込みが完了しませんでした。");
}

async function inspectTimeDestination(tabId, destinationName) {
  const tab = await chrome.tabs.get(tabId);
  const url = typeof tab?.url === "string" && tab.url
    ? tab.url
    : typeof tab?.pendingUrl === "string" ? tab.pendingUrl : "";
  const permissionPattern = HOST_PERMISSION_BY_DESTINATION[destinationName] || null;
  let hasHostPermission = null;
  if (permissionPattern && chrome.permissions?.contains) {
    try {
      hasHostPermission = await chrome.permissions.contains({ origins: [permissionPattern] });
    } catch {
      hasHostPermission = null;
    }
  }
  return Object.freeze({
    tabId,
    url,
    status: typeof tab?.status === "string" ? tab.status : "unknown",
    urlMatches: timeRecordProtocol.isDestinationUrl(url, destinationName),
    permissionPattern,
    hasHostPermission,
  });
}

async function deliverTimePayload(tabId, payload, destinationName, initialAccess) {
  let lastError;
  let lastStage = "send-message";
  let lastAccess = initialAccess;
  let recoveryError = null;
  let recoveryStage = null;
  let injectionAttempts = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "time-records:deliver", payload });
      if (response?.ok) return;
      lastError = new Error(response?.message || "Webアプリが連携データを受け取れませんでした。");
      lastStage = "send-message-response";
    } catch (error) {
      lastError = error;
      lastStage = "send-message";
      if ((destinationName === "research" || destinationName === "researchPreview") && isMissingReceiverError(error)
        && injectionAttempts < 3 && attempt % 10 === 0) {
        injectionAttempts += 1;
        lastAccess = await inspectTimeDestination(tabId, destinationName);
        if (!lastAccess.urlMatches || lastAccess.status === "loading") {
          lastStage = lastAccess.status === "loading" ? "target-loading" : "target-url";
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        if (lastAccess.hasHostPermission === false) {
          throw timeDeliveryError("host-permission", lastAccess, "対象URLへの実効ホスト権限がありません。");
        }
        try {
          await injectTimeRecordBridge(tabId);
        } catch (injectionError) {
          lastError = injectionError;
          lastStage = "script-injection";
          recoveryError = injectionError;
          recoveryStage = lastStage;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  lastAccess = await inspectTimeDestination(tabId, destinationName).catch(() => lastAccess);
  const finalError = recoveryError || lastError;
  const finalStage = recoveryStage || lastStage;
  throw timeDeliveryError(finalStage, lastAccess, finalError instanceof Error ? finalError.message : "受信処理から応答がありません。");
}

async function injectTimeRecordBridge(tabId) {
  if (!chrome.scripting?.executeScript) {
    throw new Error("受信処理を復旧できないChrome環境です。");
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["timeRecordProtocol.js", "timeRecordBridge.js"],
  });
}

function isMissingReceiverError(error) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return /receiving end does not exist|could not establish connection|message port closed/i.test(detail);
}

function timeDeliveryError(stage, access, detail) {
  const url = access?.url || "取得不可";
  const permission = access?.hasHostPermission === true
    ? "あり"
    : access?.hasHostPermission === false ? "なし" : "確認不可";
  const safeDetail = String(detail || "不明なエラー").replace(/[\r\n\u0000-\u001f\u007f]/g, " ").slice(0, 240);
  return new Error(
    `研究用アプリへの連携に失敗しました（段階: ${stage}／タブID: ${access?.tabId ?? "不明"}／URL: ${url}／ホスト権限: ${permission}）。${safeDetail} 確定済みの利用時間は保持されています。`,
  );
}

function formatTimeTransferError(error) {
  const detail = error instanceof Error ? error.message : String(error || "");
  const selectedTarget = WEB_APP_URLS[destination?.value] || WEB_APP_URLS.production;
  if (/VERCEL_PREVIEW_AUTH_REQUIRED|preview-authentication/i.test(detail)) {
    return `研究用Vercel Previewへのログインが必要です。開いたタブでVercelにログインし、${selectedTarget} のアプリ画面が表示されたことを確認してから「帳簿へ連携」を再実行してください。確定済みの利用時間は保持されています。`;
  }
  if (/cannot access contents|must request permission|not allowed to access|missing host permission/i.test(detail)) {
    return `${detail} Chromeで本拡張の「詳細」→「サイトへのアクセス」を開き、${new URL(selectedTarget).origin}が許可されているか確認してください。「すべてのサイト」の許可は不要です。`;
  }
  if (isMissingReceiverError(error)) {
    return `研究用アプリの受信処理が見つかりません。拡張機能と ${selectedTarget} のタブを再読み込みしてから再送してください。確定済みの利用時間は保持されています。`;
  }
  return detail || "利用時間を連携できませんでした。確定済みの利用時間は保持されています。";
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number.isFinite(totalSeconds) ? Math.floor(totalSeconds) : 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}時間${minutes}分${rest}秒` : `${minutes}分${rest}秒`;
}

function formatAccessError(error, fallback) {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/VERCEL_PREVIEW_AUTH_REQUIRED/i.test(detail)) {
    return "研究用Vercel Previewへのログインが必要です。開いたタブでVercelにログインし、アプリ画面が表示された後、元のAI会話へ戻って「思考レシート化する」を再実行してください。会話はまだWebアプリへ保存されていません。";
  }
  if (/cannot access contents|must request permission|not allowed to access|missing host permission/i.test(detail)) {
    return "現在、ChatGPTへのサイトアクセス権限がありません。Chromeの拡張機能管理画面で「AI Thought Receipt Bridge」→「詳細」→「サイトへのアクセス」を開き、chatgpt.com（またはchat.openai.com）で許可してから会話ページを再読み込みしてください。「すべてのサイト」の許可は不要です。";
  }
  if (/receiving end does not exist|could not establish connection/i.test(detail)) {
    return "現在、拡張機能のページ接続を確認できません。拡張機能と対象ページを再読み込みしてから、もう一度お試しください。保存済みデータは変更されていません。";
  }
  return detail || fallback;
}

async function runConversationDiagnostic() {
  conversationDiagnostic.disabled = true;
  diagnosticStatus.textContent = "会話本文を含めずに、取得段階を確認しています…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || inferAiService(tab.url) === "その他") {
      throw new Error("対応するAIの会話ページを開いてから診断してください。");
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractConversationFromPage,
      args: [{ diagnosticOnly: true }],
    });
    const diagnostic = result?.result?.diagnostic;
    if (!diagnostic || diagnostic.schemaVersion !== 1) throw new Error("診断結果を取得できませんでした。");
    diagnosticStatus.textContent = `診断（本文なし）：注入成功／サービス ${diagnostic.aiService}／現在形式の話者 ${diagnostic.currentRoleMarkers}件（本人 ${diagnostic.currentUserMarkers}・AI ${diagnostic.currentAssistantMarkers}）／本文候補 ${diagnostic.bodyCandidates}件（内容あり ${diagnostic.nonEmptyBodies}）／取得結果 ${diagnostic.extractedMessages}件（本人 ${diagnostic.extractedUserMessages}・AI ${diagnostic.extractedAssistantMessages}）／旧形式外枠 ${diagnostic.legacyTurnWrappers}件。`;
  } catch (error) {
    diagnosticStatus.textContent = formatAccessError(error, "会話取得を診断できませんでした。");
  } finally {
    conversationDiagnostic.disabled = false;
  }
}

function normalizeConversation(extracted, tab) {
  const capturedAt = formatCapturedAt(new Date());
  const url = extracted?.url || tab.url || "";
  const title = extracted?.conversationTitle || tab.title || "無題の会話";
  const messages = Array.isArray(extracted?.messages) ? extracted.messages.filter(message => (message?.role === "user" || message?.role === "assistant") && typeof message.text === "string" && message.text.trim()) : [];
  if (!messages.length) throw new Error(`会話本文が見つかりません（${inferAiService(tab.url)}／拡張機能 ${extensionVersion}）。質問と回答が表示された会話を開き、回答の生成が終わってから実行してください。改善しない場合は会話ページを再読み込みし、このサービス名とバージョンをお知らせください。`);

  return {
    aiService: inferAiService(tab.url),
    url,
    capturedAt,
    conversationTitle: cleanupTitle(title),
    messages,
  };
}

function formatCapturedAt(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function cleanupTitle(title) {
  return cleanupText(title)
    .replace(/\s*[-|]\s*(ChatGPT|Claude|Gemini|Perplexity|NotebookLM|Copilot).*$/i, "")
    .trim();
}

function cleanupText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function inferAiService(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "その他";
    const services = { "chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT", "gemini.google.com": "Gemini", "claude.ai": "Claude", "www.perplexity.ai": "Perplexity", "perplexity.ai": "Perplexity", "notebooklm.google.com": "NotebookLM", "copilot.microsoft.com": "Copilot" };
    return Object.prototype.hasOwnProperty.call(services, parsed.hostname) ? services[parsed.hostname] : "その他";
  } catch { return "その他"; }
}

// Keep this function self-contained: Chrome serializes it into the active page.
async function extractConversationFromPage(options) {
  const services = {
    "chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT", "claude.ai": "Claude",
    "gemini.google.com": "Gemini", "perplexity.ai": "Perplexity", "www.perplexity.ai": "Perplexity",
    "notebooklm.google.com": "NotebookLM", "copilot.microsoft.com": "Copilot",
  };
  const aiService = window.location.protocol === "https:" && Object.prototype.hasOwnProperty.call(services, window.location.hostname) ? services[window.location.hostname] : null;
  if (!aiService) return { messages: [] };
  // Some layouts keep a hidden/empty main before the actual conversation, or
  // render the chat outside main. Speaker markers, not the first main, identify it.
  const scope = document.body;
  const navigation = "nav, aside, [role='navigation'], [role='menu']";
  const explicitRoles = {
    user: "[data-message-author-role='user']",
    assistant: "[data-message-author-role='assistant']",
  };
  const providers = {
    ChatGPT: {
      user: explicitRoles.user + ", article[data-turn='user'], [data-testid^='conversation-turn-'][data-turn='user']",
      assistant: explicitRoles.assistant + ", article[data-turn='assistant'], [data-testid^='conversation-turn-'][data-turn='assistant']",
      userBody: "[data-testid='user-message'], [data-message-author-role='user'], .whitespace-pre-wrap",
      assistantBody: "[data-message-author-role='assistant'], [data-message-content], .markdown, .prose",
    },
    Claude: {
      user: "[data-testid='user-message'], [data-message-author-role='user']",
      assistant: "[data-testid='assistant-message'], .font-claude-response, [data-message-author-role='assistant']",
      userBody: ".whitespace-pre-wrap", assistantBody: ".font-claude-response, .markdown",
    },
    Gemini: {
      user: "user-query, [data-test-id='user-query'], [data-message-author-role='user']",
      assistant: "model-response, [data-test-id='model-response'], [data-message-author-role='assistant']",
      userBody: ".query-text, .query-content", assistantBody: "message-content, .model-response-text, .markdown",
    },
    // Preserve the other services where the page explicitly marks each speaker.
    // Do not guess roles from alternating articles, menu items or arbitrary text.
    Perplexity: { ...explicitRoles, user: explicitRoles.user + ", [data-testid='user-query']", assistant: explicitRoles.assistant + ", [data-testid='answer']" },
    NotebookLM: { ...explicitRoles, user: explicitRoles.user + ", [data-testid='user-message']", assistant: explicitRoles.assistant + ", [data-testid='assistant-message']" },
    Copilot: { ...explicitRoles, user: explicitRoles.user + ", [data-testid='user-message']", assistant: explicitRoles.assistant + ", [data-testid='bot-message']" },
  };
  const config = providers[aiService];
  const selector = config.user + ", " + config.assistant;
  // A bounded retry accommodates UI hydration without collecting background
  // conversations, sending empty data, or waiting indefinitely.
  let messages = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    messages = readMessages();
    if (messages.length || attempt === 4) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (options?.diagnosticOnly === true) {
    return { diagnostic: buildDiagnostic(messages) };
  }
  return {
    aiService,
    url: window.location.href,
    conversationTitle: findTitle(),
    messages: messages.slice(-20),
  };

  function readMessages() {
    if (aiService === "ChatGPT") {
      const roleMessages = readCurrentChatGptMessages();
      if (roleMessages !== null) return roleMessages;
      const turnMessages = readChatGptTurns();
      if (turnMessages !== null) return turnMessages;
    }
    const nodes = Array.from(scope.querySelectorAll(selector));
    const nodeSet = new Set(nodes);
    return nodes.filter(node => {
      if (!isVisible(node) || node.closest(navigation)) return false;
      if (node.matches(config.user) && node.matches(config.assistant)) return false;
      const role = node.matches(config.user) ? "user" : "assistant";
      const opposite = role === "user" ? config.assistant : config.user;
      if (node.querySelector(opposite)) return false;
      // One DOM message may match multiple nested markers; keep its outer wrapper.
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (nodeSet.has(parent) && parent.matches(role === "user" ? config.user : config.assistant)
          && !parent.querySelector(opposite)) return false;
      }
      return true;
    }).map(node => {
      const role = node.matches(config.user) ? "user" : "assistant";
      const bodySelector = role === "user" ? config.userBody : config.assistantBody;
      const bodies = bodySelector ? Array.from(node.querySelectorAll(bodySelector)).filter(isVisible) : [];
      const outerBodies = bodies.filter(body => !bodies.some(parent => parent !== body && parent.contains(body)));
      const text = (outerBodies.length ? outerBodies : [node]).map(readBodyText).filter(Boolean).join("\n\n");
      return { role, text };
    }).filter(message => message.text.length > 0);
  }

  function readCurrentChatGptMessages() {
    const markerSelector = "[data-conversation-role='user'], [data-conversation-role='assistant']";
    const markers = Array.from(scope.querySelectorAll(markerSelector)).filter(marker => (
      isVisible(marker) && !marker.closest(navigation)
    ));
    if (!markers.length) return null;
    return markers.map(marker => {
      const role = marker.getAttribute("data-conversation-role");
      const body = findCurrentChatGptBody(marker);
      const text = body ? readBodyText(body) : "";
      return text ? { role, text } : null;
    }).filter(Boolean);
  }

  function findCurrentChatGptBody(marker) {
    const sibling = marker.nextElementSibling;
    if (sibling && isVisible(sibling) && !sibling.matches("input, textarea, [contenteditable='true']")) return sibling;
    const parent = marker.parentElement;
    if (!parent) return null;
    return Array.from(parent.children).find(child => (
      child !== marker && isVisible(child)
      && !child.matches("[data-conversation-role], input, textarea, [contenteditable='true']")
    )) || null;
  }

  function readChatGptTurns() {
    const turnSelector = "[data-testid^='conversation-turn-']";
    const turns = Array.from(scope.querySelectorAll(turnSelector)).filter(turn => {
      if (!isVisible(turn) || turn.closest(navigation)) return false;
      return !turn.parentElement?.closest(turnSelector);
    });
    if (!turns.length) return null;
    return turns.map(turn => {
      const role = findChatGptTurnRole(turn);
      if (!role) return null;
      const bodySelector = role === "user" ? config.userBody : config.assistantBody;
      const bodies = Array.from(turn.querySelectorAll(bodySelector)).filter(isVisible);
      const outerBodies = bodies.filter(body => !bodies.some(parent => parent !== body && parent.contains(body)));
      const text = outerBodies.map(readBodyText).filter(Boolean).join("\n\n");
      return text ? { role, text } : null;
    }).filter(Boolean);
  }

  function findChatGptTurnRole(turn) {
    const roleAttributes = ["data-turn", "data-message-author-role", "data-author"];
    for (const attribute of roleAttributes) {
      const value = String(turn.getAttribute(attribute) || "").toLowerCase();
      if (value === "user" || value === "assistant") return value;
    }
    const descendantRoles = new Set(Array.from(turn.querySelectorAll("[data-message-author-role]"))
      .map(node => String(node.getAttribute("data-message-author-role") || "").toLowerCase())
      .filter(value => value === "user" || value === "assistant"));
    if (descendantRoles.size === 1) return Array.from(descendantRoles)[0];
    if (descendantRoles.size > 1) return null;

    // Current ChatGPT turns expose the speaker through an accessibility heading
    // even when data-turn/data-message-author-role is absent. Only accept exact,
    // known speaker labels; never infer a role from turn order or CSS position.
    const userLabels = new Set(["you", "you said", "user", "user said", "あなた", "あなたの発言", "ユーザー", "ユーザーの発言"]);
    const assistantLabels = new Set(["chatgpt", "chatgpt said", "chatgptの発言", "chatgpt の発言", "assistant", "assistant said", "アシスタント", "アシスタントの発言"]);
    const markers = Array.from(turn.querySelectorAll("h1, h2, h3, h4, h5, h6, [aria-label]"));
    for (const marker of markers) {
      if (marker.closest("[data-message-content], [data-testid='user-message'], .markdown, .prose")) continue;
      const raw = marker.getAttribute("aria-label") || marker.textContent || "";
      const label = raw.replace(/\s+/g, " ").trim().replace(/[：:]$/, "").trim().toLowerCase();
      if (userLabels.has(label)) return "user";
      if (assistantLabels.has(label)) return "assistant";
    }
    return null;
  }

  function buildDiagnostic(extracted) {
    const currentMarkers = Array.from(scope.querySelectorAll("[data-conversation-role='user'], [data-conversation-role='assistant']"))
      .filter(marker => isVisible(marker) && !marker.closest(navigation));
    const bodies = currentMarkers.map(findCurrentChatGptBody).filter(Boolean);
    return {
      schemaVersion: 1,
      aiService,
      readyState: document.readyState,
      currentRoleMarkers: currentMarkers.length,
      currentUserMarkers: currentMarkers.filter(marker => marker.getAttribute("data-conversation-role") === "user").length,
      currentAssistantMarkers: currentMarkers.filter(marker => marker.getAttribute("data-conversation-role") === "assistant").length,
      bodyCandidates: bodies.length,
      nonEmptyBodies: bodies.filter(body => readBodyText(body).length > 0).length,
      legacyTurnWrappers: scope.querySelectorAll("[data-testid^='conversation-turn-']").length,
      legacyAuthorMarkers: scope.querySelectorAll("[data-message-author-role='user'], [data-message-author-role='assistant']").length,
      extractedMessages: extracted.length,
      extractedUserMessages: extracted.filter(message => message.role === "user").length,
      extractedAssistantMessages: extracted.filter(message => message.role === "assistant").length,
    };
  }

  function isVisible(element) {
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  }

  function readBodyText(element) {
    return read(element).replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    function read(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE || !isVisible(node)
        || node.matches("button, [role='button'], input, textarea, select, nav, aside, [role='navigation'], [role='menu'], script, style, svg")) return "";
      if (node.tagName === "BR") return "\n";
      const text = Array.from(node.childNodes).map(read).join("");
      return /^(P|DIV|LI|PRE|BLOCKQUOTE|H[1-6]|TR)$/.test(node.tagName) ? "\n" + text + "\n" : text;
    }
  }

  function findTitle() {
    const selectors = "[data-testid='conversation-title'], [data-test-id='conversation-title'], [data-testid='chat-title'], h1";
    const heading = Array.from(scope.querySelectorAll(selectors)).filter(node => isVisible(node) && !node.closest(navigation)).map(readBodyText)
      .find(text => text && !/^(ChatGPT|Claude|Gemini|Perplexity|NotebookLM|Copilot)$/i.test(text));
    return String(heading || document.title || "").replace(/\s*[-|–—]\s*(ChatGPT|Claude|Gemini|Perplexity|NotebookLM|Copilot).*$/i, "")
      .replace(/\s+/g, " ").trim() || aiService + "の会話";
  }
}
