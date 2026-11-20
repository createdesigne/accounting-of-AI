import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const extensionStyles = readFileSync(new URL("../src/weekly/weeklyExtensionImportScreen.css", import.meta.url), "utf8");
const sharedStyles = readFileSync(new URL("../src/weekly/weeklyResearchTypography.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");

test("extension help and shared blue states use readable foreground/background pairs", () => {
  assert.match(extensionStyles, /weekly-intro-card\.weekly-extension-help[\s\S]*color: #1e293b[\s\S]*background: #f8fbff/);
  assert.match(sharedStyles, /secondary-action[\s\S]*color: #1e3a8a[\s\S]*background: #dbeafe/);
  assert.match(sharedStyles, /bottom-nav button\.active[\s\S]*color: #1e3a8a[\s\S]*background: #dbeafe/);
  assert.ok(contrast("#1e293b", "#f8fbff") >= 4.5);
  assert.ok(contrast("#334155", "#f8fbff") >= 4.5);
  assert.ok(contrast("#1e3a8a", "#dbeafe") >= 4.5);
  assert.ok(contrast("#ffffff", "#2563eb") >= 4.5);
});

test("research typography preserves hierarchy and prevents narrow-screen overflow", () => {
  for (const size of ["30px", "22px", "17px", "18px", "16px", "14px"]) {
    assert.ok(sharedStyles.includes(`font-size: ${size}`), `missing type size ${size}`);
  }
  assert.match(sharedStyles, /min-width: 0/);
  assert.match(sharedStyles, /max-width: 100%/);
  assert.match(sharedStyles, /@media \(max-width: 390px\)/);
  assert.match(workspace, /weeklyResearchTypography\.css/);
});

function contrast(foreground: string, background: string) {
  const light = luminance(foreground);
  const dark = luminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  return channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}
