import { createContext, useCallback, useContext, type ReactNode } from "react";

type Messages = Record<string, unknown>;
type TranslationValue = string | number | boolean | null | undefined;
type TranslationValues = Record<string, TranslationValue>;

type IntlContextValue = {
  locale: string;
  messages: Messages;
  timeZone?: string;
};

const IntlContext = createContext<IntlContextValue | null>(null);

export function I18nProvider({
  children,
  locale,
  messages,
  timeZone,
}: {
  children: ReactNode;
  locale: string;
  messages: Messages;
  timeZone?: string;
}) {
  return <IntlContext.Provider value={{ locale, messages, timeZone }}>{children}</IntlContext.Provider>;
}

export function useLocale() {
  return useIntlContext().locale;
}

export function useTimeZone() {
  return useIntlContext().timeZone;
}

export function useTranslations(namespace?: string) {
  const { messages } = useIntlContext();

  return useCallback(
    (key: string, values?: TranslationValues) => {
      const resolvedKey = namespace ? `${namespace}.${key}` : key;
      const message = readMessage(messages, resolvedKey);
      if (typeof message !== "string") return resolvedKey;
      return formatMessage(message, values);
    },
    [messages, namespace],
  );
}

function useIntlContext() {
  const value = useContext(IntlContext);
  if (!value) throw new Error("I18nProvider is missing");
  return value;
}

function readMessage(messages: Messages, key: string) {
  return key.split(".").reduce<unknown>((value, part) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Messages)[part];
  }, messages);
}

function formatMessage(message: string, values?: TranslationValues) {
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? match : String(value);
  });
}
