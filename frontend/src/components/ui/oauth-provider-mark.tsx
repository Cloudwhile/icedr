"use client";

import { LocalIcon } from "./app-icon";
import type { OAuthProviderKey } from "@/lib/drive-api";
import "./oauth-provider-mark.css";

type OAuthProviderMarkProps = {
  className?: string;
  provider: OAuthProviderKey;
  size?: "sm" | "md" | "lg";
};

export function OAuthProviderMark({ className, provider, size = "md" }: OAuthProviderMarkProps) {
  const content = renderProviderIcon(provider);
  return (
    <span className={["drive-oauth-provider-mark", `drive-oauth-provider-mark-${size}`, className].filter(Boolean).join(" ")} data-provider={provider}>
      {content}
    </span>
  );
}

function renderProviderIcon(provider: OAuthProviderKey) {
  if (provider === "google") {
    return (
      <span aria-hidden="true" className="drive-oauth-google-mark">
        G
      </span>
    );
  }
  if (provider === "github") {
    return <span aria-hidden="true" className="drive-oauth-github-mark" />;
  }
  if (provider === "microsoft") {
    return (
      <span aria-hidden="true" className="drive-oauth-microsoft-mark">
        <span />
        <span />
        <span />
        <span />
      </span>
    );
  }
  if (provider === "gitlab") {
    return (
      <span aria-hidden="true" className="drive-oauth-gitlab-mark">
        <span />
        <span />
        <span />
      </span>
    );
  }
  if (provider === "icetowne-blog") {
    return <LocalIcon name="key" size={18} />;
  }
  return <LocalIcon name="earth" size={18} />;
}
