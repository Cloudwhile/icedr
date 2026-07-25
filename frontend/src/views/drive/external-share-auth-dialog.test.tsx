import type { InputHTMLAttributes, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes, type DriveItem } from "@/features/file/model";
import { ShareAuthDialog } from "./external-share-auth-dialog";

vi.mock("@heroui/react", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Modal: {
      Backdrop: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
        isOpen ? <div>{children}</div> : null,
      Body: Part,
      Container: Part,
      Dialog: Part,
      Header: Part,
      Heading: Part,
    },
  };
});

vi.mock("@/components/ui/motion", () => ({
  MotionPresence: ({ children, show }: { children: ReactNode; show: boolean }) =>
    show ? <>{children}</> : null,
}));

vi.mock("@/components/ui/segmented-tool-group", () => ({
  SegmentedToolGroup: ({
    ariaLabel,
    onChange,
    options,
  }: {
    ariaLabel: string;
    onChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
  }) => (
    <div aria-label={ariaLabel} role="group">
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./auth-form-primitives", () => ({
  AuthField: ({ children, label }: { children: ReactNode; label: string }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  AuthInput: ({
    palette: _palette,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { palette: unknown }) => <input {...props} />,
  AuthPrimaryButton: ({
    busy,
    children,
    disabled,
    onClick,
  }: {
    busy?: boolean;
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled || busy} onClick={onClick}>
      {children}
    </button>
  ),
  AuthStatusNotice: ({ status }: { status: { message: string; tone?: string } }) => (
    <div role={status.tone === "error" ? "alert" : "status"}>{status.message}</div>
  ),
}));

vi.mock("./drive-primitives", () => ({
  ItemIcon: () => null,
  LocalIcon: () => null,
  ToolButton: ({
    children,
    label,
    onClick,
  }: {
    children: ReactNode;
    label: string;
    onClick: () => void;
  }) => (
    <button aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
}));

const accessItem: DriveItem = {
  id: "file-1",
  name: "report.pdf",
  kind: "other",
  parentId: null,
  owner: "Owner",
  modifiedAt: "2026-07-15T12:00:00.000Z",
  sizeBytes: 128,
  shared: true,
  starred: false,
  colorKey: "primary",
};

const commonProps = {
  accessExperience: {
    hasSpeedLimit: false,
    label: "Email visitor",
    waitSeconds: 0,
    speedLabel: "Unlimited",
    sessionLabel: "No limit",
  },
  accessItem,
  action: "download" as const,
  accountConfigured: false,
  busy: false,
  emailStatus: null,
  locale: "en",
  onAccountAuth: vi.fn(),
  onChangeEmail: vi.fn(),
  onClose: vi.fn(),
  onComplete: vi.fn(),
  onContinue: vi.fn(),
  onResendCode: vi.fn(),
  open: true,
  palette: palettes.light,
  remaining: 0,
  sendCooldownSeconds: 0,
  sourceItems: [accessItem],
  verifyCooldownSeconds: 0,
};

afterEach(cleanup);

describe("ShareAuthDialog email verification", () => {
  it("allows a signed-out visitor to choose account sign-in", () => {
    const onAccountAuth = vi.fn();

    render(
      <ShareAuthDialog
        {...commonProps}
        authMethod="account"
        code=""
        email=""
        onAccountAuth={onAccountAuth}
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={vi.fn()}
        onVerifyCode={vi.fn()}
        stage="choose"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "auth.login" }));
    expect(onAccountAuth).toHaveBeenCalledOnce();
  });

  it("hides identity switching after access is verified", () => {
    render(
      <ShareAuthDialog
        {...commonProps}
        authMethod="email"
        code=""
        email="visitor@example.com"
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={vi.fn()}
        onVerifyCode={vi.fn()}
        stage="verified"
      />,
    );

    expect(
      screen.queryByRole("group", { name: "share.accountLogin / share.temporaryEmail" }),
    ).not.toBeInTheDocument();
  });

  it("announces a temporary lock and disables verification during its cooldown", () => {
    render(
      <ShareAuthDialog
        {...commonProps}
        authMethod="email"
        code="123456"
        email="visitor@example.com"
        emailStatus={{ message: "Try again in 42 seconds", tone: "error" }}
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={vi.fn()}
        onVerifyCode={vi.fn()}
        stage="code"
        verifyCooldownSeconds={42}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Try again in 42 seconds");
    expect(screen.getByRole("button", { name: "share.verifyCode" })).toBeDisabled();
  });

  it("offers icon actions to change the email or resend the code", () => {
    const onChangeEmail = vi.fn();
    const onResendCode = vi.fn();

    render(
      <ShareAuthDialog
        {...commonProps}
        authMethod="email"
        code=""
        email="visitor@example.com"
        onChangeEmail={onChangeEmail}
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onResendCode={onResendCode}
        onSendCode={vi.fn()}
        onVerifyCode={vi.fn()}
        stage="code"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "auth.changeResetEmail" }));
    fireEvent.click(screen.getByRole("button", { name: "auth.resendCode" }));

    expect(onChangeEmail).toHaveBeenCalledOnce();
    expect(onResendCode).toHaveBeenCalledOnce();
  });

  it("submits a valid email from the email access stage", () => {
    const onSendCode = vi.fn();

    render(
      <ShareAuthDialog
        {...commonProps}
        authMethod="email"
        code=""
        email="visitor@example.com"
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={onSendCode}
        onVerifyCode={vi.fn()}
        stage="email"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.sendCode" }));
    expect(onSendCode).toHaveBeenCalledOnce();
  });

  it("normalizes verification code input and submits a complete code", () => {
    const onCodeChange = vi.fn();
    const onVerifyCode = vi.fn();

    render(
      <ShareAuthDialog
        {...commonProps}
        authMethod="email"
        code="123456"
        email="visitor@example.com"
        onCodeChange={onCodeChange}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={vi.fn()}
        onVerifyCode={onVerifyCode}
        stage="code"
      />,
    );

    fireEvent.change(screen.getByLabelText("share.codePrompt"), {
      target: { value: "12a34567" },
    });
    expect(onCodeChange).toHaveBeenCalledWith("123456");

    fireEvent.click(screen.getByRole("button", { name: "share.verifyCode" }));
    expect(onVerifyCode).toHaveBeenCalledOnce();
  });

  it("allows email authentication before a locked share exposes an item", () => {
    const onSendCode = vi.fn();
    const onVerifyCode = vi.fn();
    const { rerender } = render(
      <ShareAuthDialog
        {...commonProps}
        accessItem={null}
        authMethod="email"
        code=""
        email="visitor@example.com"
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={onSendCode}
        onVerifyCode={onVerifyCode}
        stage="email"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.sendCode" }));
    expect(onSendCode).toHaveBeenCalledOnce();

    rerender(
      <ShareAuthDialog
        {...commonProps}
        accessItem={null}
        authMethod="email"
        code="123456"
        email="visitor@example.com"
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={onSendCode}
        onVerifyCode={onVerifyCode}
        stage="code"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.verifyCode" }));
    expect(onVerifyCode).toHaveBeenCalledOnce();
  });

  it("allows account authentication before a locked share exposes an item", () => {
    const onAccountAuth = vi.fn();

    render(
      <ShareAuthDialog
        {...commonProps}
        accessItem={null}
        accountConfigured
        authMethod="account"
        code=""
        email=""
        onAccountAuth={onAccountAuth}
        onCodeChange={vi.fn()}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={vi.fn()}
        onVerifyCode={vi.fn()}
        stage="choose"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "share.useIcaIdentity" }));
    expect(onAccountAuth).toHaveBeenCalledOnce();
  });

  it("completes share-level access without an exposed item", () => {
    const onComplete = vi.fn();

    render(
      <ShareAuthDialog
        {...commonProps}
        accessItem={null}
        authMethod="email"
        code=""
        email="visitor@example.com"
        onCodeChange={vi.fn()}
        onComplete={onComplete}
        onEmailChange={vi.fn()}
        onMethodChange={vi.fn()}
        onSendCode={vi.fn()}
        onVerifyCode={vi.fn()}
        stage="download"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "actions.download" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
