"use client";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { palettes, type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { getMessages } from "@/i18n/messages";
import { LocalIcon, ToolButton } from "./drive-primitives";
const localeStorageKey = "icedr.ui.locale";
const themeModeStorageKey = "icedr.ui.themeMode";
function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh";
}
function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}
export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(localeStorageKey);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}
export function readStoredThemeMode(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(themeModeStorageKey);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}
export function resolveSystemLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some(language => language.toLowerCase().startsWith("zh")) ? "zh" : "en";
}
export function resolveSystemThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
export function persistLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localeStorageKey, locale);
  } catch {
    return;
  }
}
export function persistThemeMode(themeMode: ThemeMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(themeModeStorageKey, themeMode);
  } catch {
    return;
  }
}
function resolvePreferredLocale() {
  return readStoredLocale() ?? resolveSystemLocale();
}
function resolvePreferredThemeMode() {
  return readStoredThemeMode() ?? resolveSystemThemeMode();
}
export type DriveShellState = {
  locale: Locale;
  palette: Palette;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
};
export function LocalizedDriveShell({
  children
}: {
  children: (state: DriveShellState) => ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(resolvePreferredLocale);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(resolvePreferredThemeMode);
  const palette = palettes[themeMode];
  const setLocale: Dispatch<SetStateAction<Locale>> = next => {
    setLocaleState(previous => {
      const resolved = typeof next === "function" ? (next as (value: Locale) => Locale)(previous) : next;
      persistLocale(resolved);
      return resolved;
    });
  };
  const setThemeMode: Dispatch<SetStateAction<ThemeMode>> = next => {
    setThemeModeState(previous => {
      const resolved = typeof next === "function" ? (next as (value: ThemeMode) => ThemeMode)(previous) : next;
      persistThemeMode(resolved);
      return resolved;
    });
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handleSystemThemeChange = () => {
      if (!readStoredThemeMode()) setThemeModeState(resolveSystemThemeMode());
    };
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    document.documentElement.classList.toggle("light", themeMode === "light");
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.style.colorScheme = themeMode;
  }, [locale, themeMode]);
  return <NextIntlClientProvider locale={locale} messages={getMessages(locale)} timeZone="Asia/Hong_Kong">
      {children({
      locale,
      palette,
      setLocale,
      setThemeMode,
      themeMode
    })}
    </NextIntlClientProvider>;
}
export function ThemeLanguageActions({
  locale,
  palette,
  setLocale,
  setThemeMode,
  themeMode
}: DriveShellState) {
  const t = useTranslations();
  return <div style={{
    alignItems: "center",
    display: "flex",
    gap: "4px"
  }}>
      <ToolButton label={t("app.theme")} palette={palette} onClick={() => setThemeMode(mode => mode === "dark" ? "light" : "dark")}>
        <LocalIcon name={themeMode === "dark" ? "sun" : "dark_mode"} size={17} />
      </ToolButton>
      <ToolButton label={t("app.language")} palette={palette} onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
        <LocalIcon name="abc" size={17} />
      </ToolButton>
    </div>;
}
