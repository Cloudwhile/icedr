import { isValidEmailAddress } from "@/features/auth/auth-input-validation";

export type ConnectionValidation = {
  errorKey: string | null;
  valid: boolean;
};

export function validateMailSettingsDraft(
  input: {
    enabled: boolean;
    fromEmail: string;
    host: string;
    passwordConfigured: boolean;
    port: number;
    replyTo: string;
    username: string;
  },
  password: string,
): ConnectionValidation {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return invalid("admin.smtpPortInvalid");
  }
  if (!input.enabled) return valid();
  if (!input.host.trim()) return invalid("admin.smtpHostRequired");
  if (!isValidEmailAddress(input.fromEmail)) {
    return invalid("admin.smtpSenderInvalid");
  }
  if (input.replyTo.trim() && !isValidEmailAddress(input.replyTo)) {
    return invalid("admin.smtpReplyToInvalid");
  }
  if (!input.username.trim()) return invalid("admin.smtpUsernameRequired");
  if (!password.trim() && !input.passwordConfigured) {
    return invalid("admin.smtpPasswordRequired");
  }
  return valid();
}

export function validateObjectStorageDraft(input: {
  accessKeyId: string;
  bucket: string;
  distributedStorageEnabled: boolean;
  endpoint: string;
  region: string;
  secretAccessKeyConfigured: boolean;
}, secret: string): ConnectionValidation {
  if (!input.distributedStorageEnabled) return valid();
  if (!isHttpUrl(input.endpoint)) return invalid("admin.storageEndpointInvalid");
  if (!input.region.trim()) return invalid("admin.storageRegionRequired");
  if (!input.bucket.trim()) return invalid("admin.storageBucketRequired");
  if (!input.accessKeyId.trim()) return invalid("admin.storageAccessKeyRequired");
  if (!secret.trim() && !input.secretAccessKeyConfigured) {
    return invalid("admin.storageSecretRequired");
  }
  return valid();
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function invalid(errorKey: string): ConnectionValidation {
  return { errorKey, valid: false };
}

function valid(): ConnectionValidation {
  return { errorKey: null, valid: true };
}
