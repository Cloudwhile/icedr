"use client";

import { I18nProvider, useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { getIntlLocale, palettes, type LanguageOption, type Locale, type Palette, type ThemeMode, type ThemePreference } from "@/features/file/model";
import { createUiThemeVariables } from "@/features/file/theme-tokens";
import { getLocaleDocument, getMessagesWithOverrides, parseTslnLocale } from "@/i18n/messages";
import { defaultPublicSiteSettings, fetchPublicSiteSettings, fetchPublicTranslationSettings, type PublicSiteSettings } from "@/lib/drive-api";
import { LocalIcon, ToolButton } from "./drive-primitives";

const localeStorageKey = "icedr.ui.locale";
const themeModeStorageKey = "icedr.ui.themeMode";
const themePreferenceStorageKey = "icedr.ui.themePreference";
const timeZonePreferenceStorageKey = "icedr.ui.timeZonePreference";

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && value.trim().length > 0;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || isThemeMode(value);
}

function isTimeZonePreference(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidTimeZone(value: string) {
  if (value === "system") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
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

export function readStoredThemePreference(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(themePreferenceStorageKey);
    if (isThemePreference(value)) return value;
    return readStoredThemeMode();
  } catch {
    return null;
  }
}

export function readStoredTimeZonePreference(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(timeZonePreferenceStorageKey);
    return isTimeZonePreference(value) && isValidTimeZone(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolveSystemLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

export function resolveSystemThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveSystemTimeZone() {
  if (typeof Intl === "undefined") return "UTC";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
  persistThemePreference(themeMode);
}

export function persistThemePreference(themePreference: ThemePreference) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(themePreferenceStorageKey, themePreference);
    if (themePreference === "system") window.localStorage.removeItem(themeModeStorageKey);
    else window.localStorage.setItem(themeModeStorageKey, themePreference);
  } catch {
    return;
  }
}

export function persistTimeZonePreference(timeZonePreference: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(timeZonePreferenceStorageKey, timeZonePreference);
  } catch {
    return;
  }
}

function resolvePreferredLocale() {
  return readStoredLocale() ?? resolveSystemLocale();
}

function resolvePreferredThemePreference(): ThemePreference {
  return readStoredThemePreference() ?? "system";
}

function resolvePreferredTimeZonePreference() {
  return readStoredTimeZonePreference() ?? "system";
}

export type DriveShellState = {
  languageOptions: LanguageOption[];
  locale: Locale;
  palette: Palette;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  setThemePreference: Dispatch<SetStateAction<ThemePreference>>;
  setTimeZonePreference: Dispatch<SetStateAction<string>>;
  themeMode: ThemeMode;
  themePreference: ThemePreference;
  timeZone: string;
  timeZonePreference: string;
  siteSettings: PublicSiteSettings;
};

export function LocalizedDriveShell({
  children,
}: {
  children: (state: DriveShellState) => ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(resolvePreferredLocale);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(resolvePreferredThemePreference);
  const [systemThemeMode, setSystemThemeMode] = useState<ThemeMode>(resolveSystemThemeMode);
  const [timeZonePreference, setTimeZonePreferenceState] = useState<string>(resolvePreferredTimeZonePreference);
  const [systemTimeZone] = useState<string>(resolveSystemTimeZone);
  const [translationOverrides, setTranslationOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [customLanguageOptions, setCustomLanguageOptions] = useState<LanguageOption[]>([]);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
  const themeMode = themePreference === "system" ? systemThemeMode : themePreference;
  const timeZone = timeZonePreference === "system" || !isValidTimeZone(timeZonePreference) ? systemTimeZone : timeZonePreference;
  const palette = palettes[themeMode];
  const languageOptions = useMemo(() => {
    const builtInOptions: LanguageOption[] = [
      { label: getLocaleDocument("zh").language || "zh_CN", value: "zh" },
      { label: getLocaleDocument("en").language || "en_US", value: "en" },
    ];
    const known = new Set(builtInOptions.map((option) => option.value));
    return [
      ...builtInOptions,
      ...customLanguageOptions.filter((option) => {
        if (known.has(option.value)) return false;
        known.add(option.value);
        return true;
      }),
    ];
  }, [customLanguageOptions]);
  const activeMessages = useMemo(
    () => getMessagesWithOverrides(locale, translationOverrides[locale]),
    [locale, translationOverrides],
  );
  const setLocale: Dispatch<SetStateAction<Locale>> = useCallback((next) => {
    setLocaleState((previous) => {
      const resolved = typeof next === "function" ? (next as (value: Locale) => Locale)(previous) : next;
      persistLocale(resolved);
      return resolved;
    });
  }, []);
  const setThemePreference: Dispatch<SetStateAction<ThemePreference>> = useCallback((next) => {
    setThemePreferenceState((previous) => {
      const resolved = typeof next === "function" ? (next as (value: ThemePreference) => ThemePreference)(previous) : next;
      persistThemePreference(resolved);
      return resolved;
    });
  }, []);
  const setThemeMode: Dispatch<SetStateAction<ThemeMode>> = useCallback((next) => {
    setThemePreferenceState((previousPreference) => {
      const previousMode = previousPreference === "system" ? systemThemeMode : previousPreference;
      const resolved = typeof next === "function" ? (next as (value: ThemeMode) => ThemeMode)(previousMode) : next;
      persistThemeMode(resolved);
      return resolved;
    });
  }, [systemThemeMode]);
  const setTimeZonePreference: Dispatch<SetStateAction<string>> = useCallback((next) => {
    setTimeZonePreferenceState((previous) => {
      const resolved = typeof next === "function" ? (next as (value: string) => string)(previous) : next;
      persistTimeZonePreference(resolved);
      return resolved;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handleSystemThemeChange = () => setSystemThemeMode(resolveSystemThemeMode());
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicSiteSettings()
      .then((settings) => {
        if (!cancelled) setSiteSettings(settings);
      })
      .catch(() => {
        if (!cancelled) setSiteSettings(defaultPublicSiteSettings);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicTranslationSettings()
      .then((settings) => {
        if (cancelled) return;
        const nextOverrides: Record<string, Record<string, unknown>> = {};
        const nextOptions: LanguageOption[] = [];
        settings.bundles.forEach((bundle) => {
          try {
            const document = parseTslnLocale(bundle.content);
            const mappedLocale = mapTslnCodeToLocale(bundle.code);
            nextOverrides[mappedLocale] = document.messages;
            nextOptions.push({
              label: document.language || bundle.language || bundle.code,
              value: mappedLocale,
            });
          } catch {
            return;
          }
        });
        setTranslationOverrides(nextOverrides);
        setCustomLanguageOptions(nextOptions);
      })
      .catch(() => {
        if (!cancelled) {
          setTranslationOverrides({});
          setCustomLanguageOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeMode;
    root.classList.toggle("dark", themeMode === "dark");
    root.classList.toggle("light", themeMode === "light");
    root.lang = getIntlLocale(locale);
    root.style.colorScheme = themeMode;
    Object.entries(createUiThemeVariables(palette)).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
  }, [locale, palette, themeMode]);

  return (
    <I18nProvider locale={locale} messages={activeMessages} timeZone={timeZone}>
      {children({
        languageOptions,
        locale,
        palette,
        setLocale,
        siteSettings,
        setThemeMode,
        setThemePreference,
        setTimeZonePreference,
        themeMode,
        themePreference,
        timeZone,
        timeZonePreference,
      })}
    </I18nProvider>
  );
}

export function ThemeActions({
  palette,
  setThemeMode,
  themeMode,
}: Pick<DriveShellState, "palette" | "setThemeMode" | "themeMode">) {
  const t = useTranslations();
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: "4px",
      }}
    >
      <ToolButton label={t("app.theme")} palette={palette} onClick={() => setThemeMode((mode) => (mode === "dark" ? "light" : "dark"))}>
        <LocalIcon name={themeMode === "dark" ? "sun" : "dark_mode"} size={17} />
      </ToolButton>
    </div>
  );
}

function mapTslnCodeToLocale(code: string): Locale {
  const normalized = code.trim();
  if (normalized === "zh_CN" || normalized.toLowerCase().startsWith("zh_")) return "zh";
  if (normalized === "en_US" || normalized.toLowerCase().startsWith("en_")) return "en";
  return normalized;
}
