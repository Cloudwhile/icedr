export const maxDriveFileNameBytes = 255;

export type DriveFileNameValidationCode =
  | "invalid-characters"
  | "required"
  | "reserved"
  | "trailing-space-or-dot"
  | "too-long";

export type DriveFileNameValidationResult =
  | { name: string; ok: true }
  | {
      code: DriveFileNameValidationCode;
      name: string;
      ok: false;
      values?: Record<string, number | string>;
    };

const invalidFileNameCharacters = /[<>:"/\\|?*]/;
const utf8Encoder = new TextEncoder();
const windowsReservedNames = new Set([
  "aux",
  "con",
  "nul",
  "prn",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
  ...["¹", "²", "³"].flatMap((digit) => [`com${digit}`, `lpt${digit}`]),
]);

export function validateDriveFileName(value: string): DriveFileNameValidationResult {
  if (hasMalformedUnicode(value)) {
    return { code: "invalid-characters", name: value.trim(), ok: false };
  }
  const name = value.normalize("NFC").trim();
  if (!name || name === "." || name === "..") return { code: "required", name, ok: false };
  if (invalidFileNameCharacters.test(name) || hasControlCharacter(name)) return { code: "invalid-characters", name, ok: false };
  if (/[. ]$/.test(name)) return { code: "trailing-space-or-dot", name, ok: false };
  if (windowsReservedNames.has(getFileNameBase(name))) return { code: "reserved", name, ok: false };
  if (utf8Encoder.encode(name).byteLength > maxDriveFileNameBytes) {
    return {
      code: "too-long",
      name,
      ok: false,
    };
  }
  return { name, ok: true };
}

export function getDriveFileNameErrorMessageKey(code: DriveFileNameValidationCode) {
  return `files.fileName.${code}`;
}

export function getDefaultDriveFileNameErrorMessage(result: DriveFileNameValidationResult) {
  if (result.ok) return "";
  if (result.code === "too-long") return "File name is too long";
  if (result.code === "reserved") return "File name is reserved";
  if (result.code === "trailing-space-or-dot") return "File name cannot end with a space or dot";
  if (result.code === "invalid-characters") return "File name contains invalid characters";
  return "File name is required";
}

export function getDriveFileNameConflictKey(value: string) {
  return value.normalize("NFC").trim().toLowerCase();
}

function getFileNameBase(name: string) {
  const dotIndex = name.indexOf(".");
  return (dotIndex === -1 ? name : name.slice(0, dotIndex)).trim().toLowerCase();
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}

function hasMalformedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode < 0xdc00 || nextCode > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
