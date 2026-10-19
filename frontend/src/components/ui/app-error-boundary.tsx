import {
  Component,
  useId,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  palettes,
  type Palette,
  type ThemeMode,
} from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { LocalIcon } from "./app-icon";
import {
  hardNavigateHome,
  hardReloadPage,
} from "./app-error-boundary-navigation";
import { ActionButton } from "./action-button";
import "./app-error-boundary.css";

export type AppErrorBoundaryProps = {
  children: ReactNode;
  navigateHome?: () => void;
  onError?: (error: unknown, info: ErrorInfo) => void;
  reloadPage?: () => void;
  resetKeys?: readonly unknown[];
};

export type ApiErrorStateProps = {
  detail?: string;
  fillViewport?: boolean;
  homeLabel?: string;
  message: string;
  onHome?: () => void;
  onRetry?: () => void;
  palette: Palette;
  retryLabel?: string;
  title: string;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

const initialState: AppErrorBoundaryState = {
  hasError: false,
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state = initialState;

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previousProps: AppErrorBoundaryProps) {
    if (
      this.state.hasError &&
      haveResetKeysChanged(previousProps.resetKeys, this.props.resetKeys)
    ) {
      this.setState(initialState);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <AppErrorBoundaryFallback
        navigateHome={this.props.navigateHome ?? hardNavigateHome}
        reloadPage={this.props.reloadPage ?? hardReloadPage}
      />
    );
  }
}

function AppErrorBoundaryFallback({
  navigateHome,
  reloadPage,
}: {
  navigateHome: () => void;
  reloadPage: () => void;
}) {
  const t = useTranslations("app.errorBoundary");
  const palette = palettes[resolveThemeMode()];

  return (
    <ApiErrorState
      fillViewport
      homeLabel={t("home")}
      message={t("description")}
      onHome={navigateHome}
      onRetry={reloadPage}
      palette={palette}
      retryLabel={t("reload")}
      title={t("title")}
    />
  );
}

export function ApiErrorState({
  detail,
  fillViewport = false,
  homeLabel,
  message,
  onHome,
  onRetry,
  palette,
  retryLabel,
  title,
}: ApiErrorStateProps) {
  const t = useTranslations("app.errorBoundary");
  const titleId = useId();
  const descriptionId = useId();
  const resolvedRetryLabel = retryLabel ?? t("retry");
  const resolvedHomeLabel = homeLabel ?? t("home");

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={
        fillViewport
          ? "icedr-api-error-state is-fill-viewport"
          : "icedr-api-error-state"
      }
      role="alert"
      style={{
        "--app-error-canvas": palette.canvas,
        "--app-error-danger": palette.danger,
        "--app-error-hairline": palette.hairline,
        "--app-error-ink": palette.ink,
        "--app-error-muted": palette.muted,
      } as CSSProperties}
    >
      <div className="icedr-api-error-content">
        <div className="icedr-app-error-heading">
          <span className="icedr-app-error-symbol">
            <LocalIcon color={palette.danger} name="exclamation" size={32} />
          </span>
          <div className="icedr-app-error-copy">
            <h1 id={titleId}>{title}</h1>
            <p id={descriptionId}>{message}</p>
          </div>
        </div>
        {onRetry || onHome ? (
          <div
            aria-label={t("actions")}
            className="icedr-app-error-actions"
            role="group"
          >
            {onRetry ? (
              <ActionButton
                icon={<LocalIcon name="refresh" size={18} />}
                onClick={onRetry}
                palette={palette}
                tone="primary"
              >
                {resolvedRetryLabel}
              </ActionButton>
            ) : null}
            {onHome ? (
              <ActionButton
                className="icedr-app-error-home"
                icon={<LocalIcon name="house" size={18} />}
                onClick={onHome}
                palette={palette}
              >
                {resolvedHomeLabel}
              </ActionButton>
            ) : null}
          </div>
        ) : null}
        {detail ? <p className="icedr-app-error-detail">{detail}</p> : null}
      </div>
    </section>
  );
}

function haveResetKeysChanged(
  previousKeys: readonly unknown[] | undefined,
  nextKeys: readonly unknown[] | undefined,
) {
  if (previousKeys === nextKeys) return false;
  if (!previousKeys || !nextKeys || previousKeys.length !== nextKeys.length) {
    return true;
  }
  return previousKeys.some((key, index) => !Object.is(key, nextKeys[index]));
}

function resolveThemeMode(): ThemeMode {
  if (typeof document !== "undefined") {
    const documentTheme = document.documentElement.dataset.theme;
    if (documentTheme === "dark" || documentTheme === "light") {
      return documentTheme;
    }
  }

  if (typeof window === "undefined") return "light";

  const storedPreference =
    readStoredValue("icedr.ui.themePreference") ??
    readStoredValue("icedr.ui.themeMode");
  if (storedPreference === "dark" || storedPreference === "light") {
    return storedPreference;
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function readStoredValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
