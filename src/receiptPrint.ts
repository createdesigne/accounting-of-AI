const pageStyleId = "receipt-page-size";

// CSS @page does not support "80mm auto". Measure the receipt with the
// existing print styles, then give Chrome a valid width AND height.
export function prepareReceiptPage(host: HTMLElement) {
  const frame = document.createElement("iframe");
  frame.title = "印刷サイズの計測";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:80mm;height:1000px;border:0;visibility:hidden";
  document.body.append(frame);
  try {
    const target = frame.contentDocument;
    if (!target) throw new Error("Print measurement document unavailable");
    const style = target.createElement("style");
    style.textContent = Array.from(document.styleSheets)
      .filter(sheet => (sheet.ownerNode as HTMLElement | null)?.id !== pageStyleId)
      .flatMap(sheet => Array.from(sheet.cssRules).map(rule =>
        rule instanceof CSSMediaRule && rule.conditionText === "print"
          ? Array.from(rule.cssRules, child => child.cssText).join("\n")
          : rule.cssText,
      )).join("\n");
    target.head.append(style);
    target.body.innerHTML = '<div id="root"><div class="app-shell"><main class="phone-frame"><div class="screen"></div></main></div></div>';
    target.querySelector(".screen")!.append(host.cloneNode(true));
    const height = target.querySelector<HTMLElement>(".issued-receipt-panel")!.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0) throw new Error("Invalid receipt height");
    let pageStyle = document.getElementById(pageStyleId);
    if (!pageStyle) {
      pageStyle = document.createElement("style");
      pageStyle.id = pageStyleId;
      document.head.append(pageStyle);
    }
    // Only sub-millimetre rounding for Chromium's PDF paper-size precision;
    // no page margins are added; retain the receipt's own print-safe padding.
    const heightMm = Math.ceil(height * 25.4 / 96 * 100) / 100 + 0.1;
    pageStyle.textContent = `@page { size: 80mm ${heightMm.toFixed(2)}mm; margin: 0; }`;
  } finally {
    frame.remove();
  }
}

export function clearReceiptPage() {
  document.getElementById(pageStyleId)?.remove();
}
