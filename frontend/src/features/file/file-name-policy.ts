export const maxDriveFileNameLength = 255;

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
const windowsReservedNames = new Set([
  "aux",
  "con",
  "nul",
  "prn",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

export function validateDriveFileName(value: string): DriveFileNameValidationResult {
  const name = value.normalize("NFC").trim();
  if (!name || name === "." || name === "..") return { code: "required", name, ok: false };
  if (invalidFileNameCharacters.test(name) || hasControlCharacter(name)) return { code: "invalid-characters", name, ok: false };
  if (/[. ]$/.test(name)) return { code: "trailing-space-or-dot", name, ok: false };
  if (windowsReservedNames.has(getFileNameBase(name))) return { code: "reserved", name, ok: false };
  if ([...name].length > maxDriveFileNameLength) {
    return {
      code: "too-long",
      name,
      ok: false,
      values: { max: maxDriveFileNameLength },
    };
  }
  return { name, ok: true };
}

export function getDriveFileNameErrorMessageKey(code: DriveFileNameValidationCode) {
  return `files.fileName.${code}`;
}

export function getDefaultDriveFileNameErrorMessage(result: DriveFileNameValidationResult) {
  if (result.ok) return "";
  if (result.code === "too-long") return `File name cannot exceed ${maxDriveFileNameLength} characters`;
  if (result.code === "reserved") return "File name is reserved";
  if (result.code === "trailing-space-or-dot") return "File name cannot end with a space or dot";
  if (result.code === "invalid-characters") return "File name contains invalid characters";
  return "File name is required";
}

export function getDriveFileNameConflictKey(value: string) {
  return value.normalize("NFC").trim().toLocaleLowerCase();
}

function getFileNameBase(name: string) {
  const dotIndex = name.indexOf(".");
  return (dotIndex === -1 ? name : name.slice(0, dotIndex)).trim().toLocaleLowerCase();
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
