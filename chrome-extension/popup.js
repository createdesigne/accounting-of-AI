const WEB_APP_URLS = {
  production: "https://createdesigne.github.io/accounting-of-AI/",
  preview: "https://createdesigne.github.io/accounting-of-AI/preview/month-ledger/",
  local: "http://localhost:5173/accounting-of-AI/",
};
const timeRecordProtocol = globalThis.TimeRecordProtocol;

const button = document.getElementById("createReceipt");
const statusText = document.getElementById("status");
const destination = document.getElementById("destination");
const extensionVersion = globalThis.chrome?.runtime?.getManifest?.().version || "不明";
const versionText = document.getElementById("version");
if (versionText) versionText.textContent = `バージョン ${extensionVersion}`;

const trackingStart = document.getElementById("trackingStart");
const trackingStop = document.getElementById("trackingStop");
const trackingStatus = document.getElementById("trackingStatus");
const timeLedgerTransfer = document.getElementById("timeLedgerTransfer");
const timeTransferStatus = document.getElementById("timeTransferStatus");

if (trackingStart && trackingStop && trackingStatus && chrome.runtime?.sendMessage) {
  trackingStart.addEventListener("click", () => updateTracking(true));
  trackingStop.addEventListener("click", () => updateTracking(false));
  refreshTracking();
}

if (timeLedgerTransfer && timeTransferStatus && timeRecordProtocol && chrome.runtime?.sendMessage) {
  timeLedgerTransfer.addEventListener("click", transferFinalizedTimeRecords);
}

button.addEventListener("click", async () => {
  setStatus("会話を読み取っています...", true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error("現在のタブを取得できませんでした。");
    }

    if (inferAiService(tab.url) === "その他") {
      throw new Error("ChatGPT・Claude・Geminiなど、対応するAIの会話ページで実行してください。");
    }
    const [extracted] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractConversationFromPage,
    });

    const rawConversation = normalizeConversation(extracted?.result, tab);
    const url = new URL(WEB_APP_URLS[destination.value] || WEB_APP_URLS.production);
    // A fragment is read by the app; conversation text is not sent to Pages in the HTTP URL.
    url.hash = new URLSearchParams({ draft: JSON.stringify(rawConversation) }).toString();
    if (url.href.length > 1500000) throw new Error("会話が長すぎるため送れません。短い会話でお試しください。");

    await chrome.tabs.create({ url: url.href });
    setStatus("Webアプリを開きました。", false);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "会話データを送れませんでした。", false);
  }
});

function setStatus(message, busy) {
  statusText.textContent = message;
  button.disabled = busy;
  destination.disabled = busy;
}

async function refreshTracking() {
  await sendTrackingMessage({ type: "tracking:get" });
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
  } catch (error) {
    trackingStatus.textContent = error instanceof Error ? error.message : "計測状態を確認できませんでした。";
    trackingStart.disabled = false;
    trackingStop.disabled = false;
  }
}

function renderTracking(state) {
  trackingStart.disabled = state.enabled;
  trackingStop.disabled = !state.enabled;
  if (!state.enabled) {
    trackingStatus.textContent = `停止中（保存済み ${formatDuration(state.totalSeconds)}）`;
  } else if (state.active) {
    trackingStatus.textContent = `計測中（合計 ${formatDuration(state.totalSeconds)}）`;
  } else {
    trackingStatus.textContent = `待機中：ChatGPTで操作すると計測します（合計 ${formatDuration(state.totalSeconds)}）`;
  }
}

async function transferFinalizedTimeRecords() {
  timeLedgerTransfer.disabled = true;
  timeTransferStatus.textContent = "確定済みの利用時間を準備しています…";
  try {
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
    await deliverTimePayload(targetTab.id, response.payload);
    timeTransferStatus.textContent = `${response.payload.records.length}件の利用時間を確認画面へ渡しました。まだ帳簿には保存されていません。`;
    if (chrome.tabs.update) await chrome.tabs.update(targetTab.id, { active: true });
  } catch (error) {
    console.error(error);
    timeTransferStatus.textContent = error instanceof Error ? error.message : "利用時間を連携できませんでした。";
  } finally {
    timeLedgerTransfer.disabled = false;
  }
}

async function findOrCreateTimeDestination(destinationName, targetUrl) {
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

async function deliverTimePayload(tabId, payload) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "time-records:deliver", payload });
      if (response?.ok) return;
      lastError = new Error(response?.message || "Webアプリが連携データを受け取れませんでした。");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError instanceof Error ? lastError : new Error("Webアプリへの接続がタイムアウトしました。");
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number.isFinite(totalSeconds) ? Math.floor(totalSeconds) : 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}時間${minutes}分${rest}秒` : `${minutes}分${rest}秒`;
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
async function extractConversationFromPage() {
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
      userBody: "[data-testid='user-message'], .whitespace-pre-wrap", assistantBody: ".markdown, [data-message-content]",
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
  return {
    aiService,
    url: window.location.href,
    conversationTitle: findTitle(),
    messages: messages.slice(-20),
  };

  function readMessages() {
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
