import { describe, expect, it } from "vitest";
import {
  formatRecoveryCode,
  isValidEmailAddress,
  isValidRecoveryCode,
  validateAuthSubmission,
} from "./auth-input-validation";

describe("auth input validation", () => {
  it("blocks incomplete local login before a request is sent", () => {
    const result = validateAuthSubmission({
      email: "not-an-email",
      mode: "login",
      password: "",
    });

    expect(result.errors).toEqual({
      email: "auth.emailInvalid",
      password: "auth.passwordRequired",
    });
    expect(result.firstInvalidField).toBe("email");
  });

  it("normalizes a complete login without changing the password", () => {
    const result = validateAuthSubmission({
      email: "  User@Example.com ",
      mode: "login",
      password: " password with spaces ",
    });

    expect(result.errors).toEqual({});
    expect(result.values.email).toBe("user@example.com");
    expect(result.values.password).toBe(" password with spaces ");
  });

  it("validates registration name, password, and confirmation", () => {
    const result = validateAuthSubmission({
      confirmPassword: "different-password",
      displayName: "   ",
      email: "user@example.com",
      mode: "register",
      password: "valid-password",
    });

    expect(result.errors.displayName).toBe("auth.displayNameRequired");
    expect(result.errors.confirmPassword).toBe("auth.passwordMismatch");
  });

  it("requires a complete verification code during reset verification", () => {
    const result = validateAuthSubmission({
      code: "12A",
      email: "user@example.com",
      mode: "forgot",
      step: "verify",
    });

    expect(result.errors.code).toBe("auth.codeIncomplete");
  });

  it("uses an ordinary mailbox shape for the same check as the UI", () => {
    expect(isValidEmailAddress("user@example.com")).toBe(true);
    expect(isValidEmailAddress("user@localhost")).toBe(false);
    expect(isValidEmailAddress("user @example.com")).toBe(false);
  });

  it("normalizes and validates generated recovery codes", () => {
    expect(formatRecoveryCode("2345 6789 abcd efgh")).toBe(
      "2345-6789-ABCD-EFGH",
    );
    expect(isValidRecoveryCode("2345-6789-ABCD-EFGH")).toBe(true);
    expect(isValidRecoveryCode("1111-1111-1111-1111")).toBe(false);
  });
});
