export type AuthValidationMode = "login" | "register" | "forgot" | "reset";
export type AuthValidationStep = "request" | "verify" | "reset";

export type AuthFieldName =
  | "code"
  | "confirmPassword"
  | "displayName"
  | "email"
  | "password";

export type AuthFieldErrorKey =
  | "auth.codeIncomplete"
  | "auth.confirmPasswordRequired"
  | "auth.displayNameRequired"
  | "auth.displayNameTooLong"
  | "auth.emailInvalid"
  | "auth.emailRequired"
  | "auth.passwordLengthInvalid"
  | "auth.passwordMismatch"
  | "auth.passwordRequired";

export type AuthFieldErrors = Partial<Record<AuthFieldName, AuthFieldErrorKey>>;

export type AuthSubmissionValues = {
  code: string;
  confirmPassword: string;
  displayName: string;
  email: string;
  password: string;
};

export type AuthSubmissionValidation = {
  errors: AuthFieldErrors;
  firstInvalidField: AuthFieldName | null;
  values: AuthSubmissionValues;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const verificationCodePattern = /^[A-Za-z0-9]{6}$/;
const recoveryCodePattern = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{16}$/;

export function validateAuthSubmission(input: {
  code?: string;
  confirmPassword?: string;
  displayName?: string;
  email?: string;
  mode: AuthValidationMode;
  password?: string;
  step?: AuthValidationStep;
}): AuthSubmissionValidation {
  const values: AuthSubmissionValues = {
    code: (input.code ?? "").trim(),
    confirmPassword: input.confirmPassword ?? "",
    displayName: (input.displayName ?? "").trim(),
    email: normalizeEmailAddress(input.email ?? ""),
    password: input.password ?? "",
  };
  const errors: AuthFieldErrors = {};
  const passwordResetFlow = input.mode === "forgot" || input.mode === "reset";
  const step = input.step ?? "request";

  if (input.mode === "register") {
    if (!values.displayName) errors.displayName = "auth.displayNameRequired";
    else if (values.displayName.length > 80) {
      errors.displayName = "auth.displayNameTooLong";
    }
  }

  validateEmail(values.email, errors);

  if (passwordResetFlow && step === "verify") {
    if (!verificationCodePattern.test(values.code)) {
      errors.code = "auth.codeIncomplete";
    }
  }

  const needsPassword =
    input.mode === "login" ||
    input.mode === "register" ||
    (passwordResetFlow && step === "reset");
  if (needsPassword) validatePassword(values.password, errors);

  const needsConfirmation =
    input.mode === "register" || (passwordResetFlow && step === "reset");
  if (needsConfirmation) {
    if (!values.confirmPassword) {
      errors.confirmPassword = "auth.confirmPasswordRequired";
    } else if (values.password !== values.confirmPassword) {
      errors.confirmPassword = "auth.passwordMismatch";
    }
  }

  return {
    errors,
    firstInvalidField:
      (["displayName", "email", "code", "password", "confirmPassword"] as const)
        .find((field) => Boolean(errors[field])) ?? null,
    values,
  };
}

export function normalizeEmailAddress(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmailAddress(value: string) {
  const email = normalizeEmailAddress(value);
  return email.length <= 254 && emailPattern.test(email);
}

export function isValidPasswordLength(value: string) {
  return value.length >= 8 && value.length <= 128;
}

export function normalizeRecoveryCode(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function isValidRecoveryCode(value: string) {
  return recoveryCodePattern.test(normalizeRecoveryCode(value));
}

export function formatRecoveryCode(value: string) {
  const normalized = normalizeRecoveryCode(value).slice(0, 16);
  return normalized.match(/.{1,4}/g)?.join("-") ?? normalized;
}

function validateEmail(email: string, errors: AuthFieldErrors) {
  if (!email) errors.email = "auth.emailRequired";
  else if (!isValidEmailAddress(email)) errors.email = "auth.emailInvalid";
}

function validatePassword(password: string, errors: AuthFieldErrors) {
  if (!password) errors.password = "auth.passwordRequired";
  else if (!isValidPasswordLength(password)) {
    errors.password = "auth.passwordLengthInvalid";
  }
}
