import type { TimeImportResult } from "./timeAccountingStore.ts";
import type { TimeRecordPreview } from "./timeRecordTransfer.ts";

export const TIME_AUTO_IMPORT_SETTINGS_BASE_KEY = "watashi-to-ai-time-auto-import-settings";

export type AutomaticTimeImportOutcome =
  | Readonly<{ status: "disabled" | "empty" }>
  | Readonly<{ status: "completed"; result: TimeImportResult }>;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export function loadAutomaticTimeImportEnabled(
  storage: StorageReader = window.localStorage,
  storageKey = TIME_AUTO_IMPORT_SETTINGS_BASE_KEY,
) {
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return false;
    const value: unknown = JSON.parse(raw);
    return isObject(value) && value.version === 1 && value.enabled === true;
  } catch {
    return false;
  }
}

export function saveAutomaticTimeImportEnabled(
  enabled: boolean,
  storage: StorageWriter = window.localStorage,
  storageKey = TIME_AUTO_IMPORT_SETTINGS_BASE_KEY,
) {
  storage.setItem(storageKey, JSON.stringify({ version: 1, enabled: enabled === true }));
}

export async function runAutomaticTimeImport(options: {
  enabled: boolean;
  requestRecords: () => Promise<readonly TimeRecordPreview[]>;
  importRecords: (records: readonly TimeRecordPreview[]) => Promise<TimeImportResult>;
  acknowledge: (records: readonly TimeRecordPreview[]) => Promise<void>;
  onSaved?: (result: TimeImportResult) => void;
}): Promise<AutomaticTimeImportOutcome> {
  if (!options.enabled) return Object.freeze({ status: "disabled" });
  const records = await options.requestRecords();
  if (records.length === 0) return Object.freeze({ status: "empty" });

  // importRecords verifies durable storage before it resolves. A failed save
  // therefore never reaches acknowledgement and remains pending in the extension.
  const result = await options.importRecords(records);
  options.onSaved?.(result);
  await options.acknowledge(result.records);
  return Object.freeze({ status: "completed", result });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
