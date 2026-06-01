import type { Locale } from "@/features/file/model";
import enUSSource from "./locales/en_US.tsln?raw";
import zhCNSource from "./locales/zh_CN.tsln?raw";

export type TslnLocaleDocument = {
  language: string;
  messages: Record<string, unknown>;
};

const fallbackLocale: Locale = "en";

const localeSources: Record<string, string> = {
  en: enUSSource,
  zh: zhCNSource,
};

export const messages: Record<string, Record<string, unknown>> = {
  en: parseTslnLocale(enUSSource).messages,
  zh: parseTslnLocale(zhCNSource).messages,
};

export function getMessages(locale: Locale) {
  return messages[locale] ?? messages[fallbackLocale];
}

export function getMessagesWithOverrides(locale: Locale, overrides: Record<string, unknown> | null | undefined) {
  if (!overrides) return getMessages(locale);
  return mergeMessages(getMessages(locale), overrides);
}

export function getLocaleDocument(locale: Locale) {
  return parseTslnLocale(localeSources[locale] ?? localeSources[fallbackLocale]);
}

export function parseTslnLocale(source: string): TslnLocaleDocument {
  const flatMessages: Record<string, string> = {};
  let language = "";

  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^(language|"(?:[^"\\]|\\.)+")\s*:\s*("(?:[^"\\]|\\.)*")\s*,?$/);
    if (!match) {
      throw new Error(`Invalid translation line ${index + 1}`);
    }

    const rawKey = match[1];
    const value = parseQuotedTslnValue(match[2], index + 1);
    if (rawKey === "language") {
      language = value;
      return;
    }

    const key = parseQuotedTslnValue(rawKey, index + 1);
    flatMessages[key] = value;
  });

  return {
    language,
    messages: expandFlatMessages(flatMessages),
  };
}

function parseQuotedTslnValue(value: string, line: number) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("Not a string");
    return parsed;
  } catch {
    throw new Error(`Invalid translation string on line ${line}`);
  }
}

function expandFlatMessages(flatMessages: Record<string, string>) {
  const root: Record<string, unknown> = {};

  Object.entries(flatMessages).forEach(([key, value]) => {
    const parts = key.split(".").filter(Boolean);
    if (parts.length === 0) return;
    let cursor = root;

    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        cursor[part] = value;
        return;
      }

      const next = cursor[part];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    });
  });

  return root;
}

function mergeMessages(base: Record<string, unknown>, overrides: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...base };

  Object.entries(overrides).forEach(([key, value]) => {
    const current = next[key];
    if (isMessageRecord(current) && isMessageRecord(value)) {
      next[key] = mergeMessages(current, value);
      return;
    }
    next[key] = value;
  });

  return next;
}

function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
