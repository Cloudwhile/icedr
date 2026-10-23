import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootI18nProvider } from "@/components/i18n/root-i18n-provider";
import { createOAuthDraft, getOAuthProviderTemplate } from "@/extensions/oauth/provider-catalog";
import { palettes } from "@/features/file/model";
import { OAuthProviderDialog } from "./oauth-provider-dialog";

beforeEach(() => localStorage.setItem("icedr.ui.locale", "en"));
afterEach(() => { cleanup(); localStorage.clear(); });

function renderError(validationErrorKey: string) {
  return render(<RootI18nProvider><OAuthProviderDialog
    draft={createOAuthDraft(getOAuthProviderTemplate("oidc"), "https://app.example")}
    mode="create" onClearSecret={vi.fn()} onClose={vi.fn()} onCopy={vi.fn()}
    onDraftChange={vi.fn()} onSave={vi.fn()} onSecretChange={vi.fn()}
    onSelectTemplate={vi.fn()} onTest={vi.fn()}
    palette={palettes.light} savingKey={null} secret=""
    testResult={null} validationErrorKey={validationErrorKey}
  /></RootI18nProvider>);
}

describe("OAuth field error presentation", () => {
  it("uses a single visibility control for the client secret", () => {
    renderError("admin.oauthSecretRequired");
    const input = screen.getByLabelText("OAuth client secret");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getAllByRole("button", { name: /show.*(password|secret)/i })).toHaveLength(1);
    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("associates a client ID error with the input and preserves the summary", () => {
    renderError("admin.oauthClientIdRequired");
    const input = screen.getByRole("textbox", { name: "OAuth client ID" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(screen.getByRole("alert").textContent ?? "");
    expect(screen.getByRole("textbox", { name: "Configuration name" })).not.toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the callback visible in basic settings", () => {
    renderError("admin.oauthRedirectInvalid");
    const input = screen.getByRole("textbox", { name: "OAuth redirect URI" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.closest("details")).toBeNull();
  });

  it("preserves domain separators while typing multiple allowed domains", () => {
    function Editor() {
      const [draft, setDraft] = useState(createOAuthDraft(getOAuthProviderTemplate("oidc"), "https://app.example"));
      return <OAuthProviderDialog draft={draft} mode="create" onClearSecret={vi.fn()} onClose={vi.fn()} onCopy={vi.fn()}
        onDraftChange={setDraft} onSave={vi.fn()} onSecretChange={vi.fn()} onSelectTemplate={vi.fn()} onTest={vi.fn()}
        palette={palettes.light} savingKey={null} secret="" testResult={null} validationErrorKey="admin.oauthDomainInvalid" />;
    }
    render(<RootI18nProvider><Editor /></RootI18nProvider>);
    const input = screen.getByRole("textbox", { name: "Allowed email domains" });
    fireEvent.change(input, { target: { value: "one.example," } });
    expect(input).toHaveValue("one.example,");
    fireEvent.change(input, { target: { value: `${(input as HTMLInputElement).value}two.example` } });
    expect(input).toHaveValue("one.example,two.example");
  });
});
