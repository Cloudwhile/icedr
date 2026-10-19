import { useState, type ReactNode } from "react";
import { useTranslations } from "@/i18n/react";
import { LocalIcon } from "./app-icon";
import "./password-field.css";

export function PasswordField({ children, disabled }: { children: (visible: boolean) => ReactNode; disabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  const t = useTranslations();
  return (
    <span className="icedr-password-field">
      {children(visible)}
      <button
        aria-label={t(visible ? "auth.hidePassword" : "auth.showPassword")}
        aria-pressed={visible}
        className="icedr-password-toggle"
        disabled={disabled}
        onClick={() => setVisible((value) => !value)}
        type="button"
      >
        <LocalIcon name={visible ? "lock" : "visible"} size={17} />
      </button>
    </span>
  );
}
