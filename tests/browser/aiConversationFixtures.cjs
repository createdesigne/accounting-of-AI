// Representative markup for adapter tests, not live-site snapshots. No fixtures
// are registered as application sample data or copied into the extension ZIP.
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const providers = {
  ChatGPT: { url: 'https://chatgpt.com/c/bridge-check', message: m => `<article data-message-author-role="${m.role}"><div class="${m.role === 'user' ? 'whitespace-pre-wrap' : 'markdown'}">${escape(m.text)}</div><button>Copy</button><span hidden>Hidden toolbar</span></article>` },
  Claude: { url: 'https://claude.ai/chat/bridge-check', message: m => m.role === 'user'
    ? `<div data-testid="user-message"><div class="whitespace-pre-wrap">${escape(m.text)}</div><button>Edit</button></div>`
    : `<div data-testid="assistant-message"><div class="font-claude-response"><div class="markdown">${escape(m.text)}</div></div><button>Retry</button></div>` },
  Gemini: { url: 'https://gemini.google.com/app/bridge-check', message: m => m.role === 'user'
    ? `<user-query><div class="query-content"><div class="query-text">${escape(m.text)}</div></div><button>Edit</button></user-query>`
    : `<model-response data-test-id="model-response"><message-content><div class="markdown">${escape(m.text)}</div></message-content><button>Good response</button></model-response>` },
};
function currentChatGptMarkup(messages, title, labels = { user: 'You said:', assistant: 'ChatGPT said:' }) {
  return `<meta charset="UTF-8"><title>${escape(title)} - ChatGPT</title><style>.css-hidden{display:none}</style>
    <aside><h1>Navigation</h1><div data-message-author-role="assistant">Sidebar</div></aside>
    <main><h1>${escape(title)}</h1>
    ${messages.map((message, index) => `<article data-testid="conversation-turn-${index}" data-scroll-anchor="true">
      <h5 class="sr-only">${escape(labels[message.role])}</h5>
      ${message.role === 'user'
        ? `<div data-testid="user-message"><div class="whitespace-pre-wrap">${escape(message.text)}</div></div>`
        : `<div data-message-content><div class="markdown prose">${escape(message.text)}</div></div>`}
      <button>Copy</button><textarea>Unsent draft</textarea>
    </article>`).join('')}</main>`;
}
function liveChatGptMarkup(messages, title) {
  return `<meta charset="UTF-8"><title>${escape(title)} - ChatGPT</title>
    <aside><div data-conversation-role="assistant">Sidebar noise</div></aside><main><h1>${escape(title)}</h1>
    ${messages.map((message, index) => message.role === 'user'
      ? `<div class="block-BQZwFn"><h4 class="sr-only" data-conversation-role="user"><span>あなたの発言:</span></h4><div class="group/user-message flex" data-chatgpt-search-unit-key="user-${index}" data-chatgpt-search-message-ids="message-${index}"><div class="whitespace-pre-wrap">${escape(message.text)}</div><button>Copy</button><textarea>Unsent draft</textarea></div></div>`
      : `<div data-content-search-unit-key="assistant-${index}" data-chatgpt-search-unit-key="assistant-${index}" data-chatgpt-search-message-ids="message-${index}"><h4 class="sr-only" data-conversation-role="assistant" tabindex="-1"><span>ChatGPT の発言:</span></h4><div data-response-body><div>${escape(message.text)}</div><button>Copy</button></div></div>`).join('')}</main>`;
}
function conversationMarkup(provider, messages, title) {
  return `<meta charset="UTF-8"><title>${escape(title)} - ${provider}</title><style>.css-hidden{display:none}</style>
    <aside><h1>Navigation</h1><div data-testid="user-profile">Profile</div><div data-message-author-role="assistant">Sidebar</div></aside>
    <main><h1>${escape(title)}</h1><nav><div data-testid="user-menu">Menu</div></nav>
    <div class="css-hidden">${providers[provider].message({ role: 'user', text: 'Hidden old branch' })}</div>
    ${messages.map(providers[provider].message).join('')}</main>`;
}
module.exports = { providers, conversationMarkup, currentChatGptMarkup, liveChatGptMarkup };
