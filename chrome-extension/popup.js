const WEB_APP_URLS = {
  production: "https://createdesigne.github.io/accounting-of-AI/",
  preview: "https://createdesigne.github.io/accounting-of-AI/preview/month-ledger/",
  local: "http://localhost:5173/accounting-of-AI/",
};

const button = document.getElementById("createReceipt");
const statusText = document.getElementById("status");
const destination = document.getElementById("destination");

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

function normalizeConversation(extracted, tab) {
  const capturedAt = formatCapturedAt(new Date());
  const url = extracted?.url || tab.url || "";
  const title = extracted?.conversationTitle || tab.title || "無題の会話";
  const messages = Array.isArray(extracted?.messages) ? extracted.messages.filter(message => typeof message?.text === "string" && message.text.trim()) : [];
  if (!messages.length) throw new Error("会話本文が見つかりません。会話を表示し直して、もう一度お試しください。");

  return {
    aiService: extracted?.aiService || inferAiService(url),
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
    return ({ "chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT", "gemini.google.com": "Gemini", "claude.ai": "Claude", "www.perplexity.ai": "Perplexity", "perplexity.ai": "Perplexity", "notebooklm.google.com": "NotebookLM", "copilot.microsoft.com": "Copilot" })[parsed.hostname] || "その他";
  } catch { return "その他"; }
}

function extractConversationFromPage() {
  const url = window.location.href;
  const aiService = inferServiceFromLocation(url);
  const conversationTitle = findConversationTitle();
  const messages = collectMessages();

  return {
    aiService,
    url,
    conversationTitle,
    messages,
  };

  function inferServiceFromLocation(currentUrl) {
    const value = String(currentUrl || "").toLowerCase();
    if (value.includes("chatgpt.com") || value.includes("chat.openai.com")) return "ChatGPT";
    if (value.includes("gemini.google.com")) return "Gemini";
    if (value.includes("claude.ai")) return "Claude";
    if (value.includes("perplexity.ai")) return "Perplexity";
    if (value.includes("notebooklm.google.com")) return "NotebookLM";
    if (value.includes("copilot.microsoft.com")) return "Copilot";
    return "その他";
  }

  function findConversationTitle() {
    const heading = document.querySelector("h1")?.textContent;
    const title = heading || document.title || "無題の会話";
    return cleanupPageText(title)
      .replace(/\s*[-|]\s*(ChatGPT|Claude|Gemini|Perplexity|NotebookLM|Copilot).*$/i, "")
      .trim();
  }

  function collectMessages() {
    const collectors = [
      collectChatGptMessages,
      collectClaudeMessages,
      collectGeminiMessages,
      collectGenericMessages,
    ];

    for (const collect of collectors) {
      const messages = collect();
      if (messages.length > 0) return messages.slice(-20);
    }

    return [];
  }

  function collectChatGptMessages() {
    return uniqueMessages(
      Array.from(document.querySelectorAll("[data-message-author-role]")).map((node) => ({
        role: normalizeRole(node.getAttribute("data-message-author-role")),
        text: cleanupPageText(node.textContent),
      })),
    );
  }

  function collectClaudeMessages() {
    return uniqueMessages(
      Array.from(document.querySelectorAll("[data-testid*='user'], [data-testid*='assistant']")).map(
        (node) => ({
          role: /user/i.test(node.getAttribute("data-testid") || "") ? "user" : "assistant",
          text: cleanupPageText(node.textContent),
        }),
      ),
    );
  }

  function collectGeminiMessages() {
    const nodes = Array.from(
      document.querySelectorAll("user-query, model-response, [data-test-id*='user'], [data-test-id*='response']"),
    );

    return uniqueMessages(
      nodes.map((node) => {
        const marker = `${node.tagName} ${node.getAttribute("data-test-id") || ""}`;
        return {
          role: /user|query/i.test(marker) ? "user" : "assistant",
          text: cleanupPageText(node.textContent),
        };
      }),
    );
  }

  function collectGenericMessages() {
    const nodes = Array.from(
      document.querySelectorAll("main article, main [role='article'], main [data-testid], main .message"),
    );

    return uniqueMessages(
      nodes.map((node, index) => ({
        role: inferRoleFromNode(node, index),
        text: cleanupPageText(node.textContent),
      })),
    );
  }

  function inferRoleFromNode(node, index) {
    const marker = [
      node.getAttribute("aria-label"),
      node.getAttribute("data-testid"),
      node.className,
      node.textContent?.slice(0, 80),
    ]
      .join(" ")
      .toLowerCase();

    if (/user|you|あなた|ユーザー/.test(marker)) return "user";
    if (/assistant|ai|回答|アシスタント|model/.test(marker)) return "assistant";
    return index % 2 === 0 ? "user" : "assistant";
  }

  function normalizeRole(role) {
    return role === "assistant" ? "assistant" : "user";
  }

  function uniqueMessages(messages) {
    const seen = new Set();
    return messages
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        text: cleanupPageText(message.text),
      }))
      .filter((message) => {
        if (!message.text || message.text.length < 2) return false;
        const key = `${message.role}:${message.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function cleanupPageText(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim();
  }
}
