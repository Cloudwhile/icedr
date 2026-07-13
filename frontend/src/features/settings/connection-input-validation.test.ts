import { describe, expect, it } from "vitest";
import {
  validateMailSettingsDraft,
  validateObjectStorageDraft,
} from "./connection-input-validation";

describe("connection settings validation", () => {
  it("blocks incomplete SMTP settings before save or test", () => {
    expect(
      validateMailSettingsDraft(
        {
          enabled: true,
          fromEmail: "not-an-email",
          host: "smtp.example.com",
          passwordConfigured: true,
          port: 587,
          replyTo: "",
          username: "mailer",
        },
        "",
      ).errorKey,
    ).toBe("admin.smtpSenderInvalid");
  });

  it("checks the SMTP port even while delivery is disabled", () => {
    expect(
      validateMailSettingsDraft(
        {
          enabled: false,
          fromEmail: "",
          host: "",
          passwordConfigured: false,
          port: 70000,
          replyTo: "",
          username: "",
        },
        "",
      ).errorKey,
    ).toBe("admin.smtpPortInvalid");
  });

  it("accepts a complete MinIO-compatible HTTP endpoint", () => {
    expect(
      validateObjectStorageDraft(
        {
          accessKeyId: "icedr",
          bucket: "icedr-drive",
          distributedStorageEnabled: true,
          endpoint: "http://127.0.0.1:9000",
          region: "us-east-1",
          secretAccessKeyConfigured: false,
        },
        "secret",
      ).valid,
    ).toBe(true);
  });

  it("rejects malformed object storage endpoints", () => {
    expect(
      validateObjectStorageDraft(
        {
          accessKeyId: "icedr",
          bucket: "icedr-drive",
          distributedStorageEnabled: true,
          endpoint: "127.0.0.1:9000",
          region: "us-east-1",
          secretAccessKeyConfigured: true,
        },
        "",
      ).errorKey,
    ).toBe("admin.storageEndpointInvalid");
  });
});
