import { useMemo, useState, type ReactNode } from "react";
import type { Locale } from "@/features/file/model";
import { getMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/react";

const localeStorageKey = "icedr.ui.locale";

export function RootI18nProvider({ children }: { children: ReactNode }) {
  const [locale] = useState<Locale>(resolveInitialLocale);
  const [timeZone] = useState(resolveInitialTimeZone);
  const messages = useMemo(() => getMessages(locale), [locale]);

  return (
    <I18nProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </I18nProvider>
  );
}

function resolveInitialLocale(): Locale {
  const storedLocale = readStoredLocale();
  if (storedLocale) return storedLocale;
  if (typeof navigator === "undefined") return "en";

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(localeStorageKey);
    return value === "en" || value === "zh" ? value : null;
  } catch {
    return null;
  }
}

function resolveInitialTimeZone() {
  if (typeof Intl === "undefined") return "UTC";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
