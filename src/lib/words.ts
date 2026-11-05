import type { VocabularyEntry } from "../types.js";

export const VIDEO_GOAL = 30;
const WORDS_KEY = "noi-custom-words-v1";
export const isCustomWordId = (value: unknown): value is string =>
  typeof value === "string" && /^NOI_USER_[a-f0-9-]{36}$/i.test(value);
export const wordKey = (label: string) =>
  label.normalize("NFC").trim().toLocaleLowerCase("vi");

export function customWord(id: string, label: string): VocabularyEntry {
  return {
    id,
    label,
    group: "Tự thêm",
    level: 0,
    aliases: [],
    definition: label,
    status: "Tự thêm",
  };
}

export function loadCustomWords(): VocabularyEntry[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(WORDS_KEY) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (e) =>
          isCustomWordId(e?.id) &&
          typeof e.label === "string" &&
          e.label.length > 0 &&
          e.label.length <= 80,
      )
      .map((e) => customWord(e.id, e.label));
  } catch {
    return [];
  }
}

export function saveCustomWords(entries: VocabularyEntry[]) {
  localStorage.setItem(WORDS_KEY, JSON.stringify(entries));
}
