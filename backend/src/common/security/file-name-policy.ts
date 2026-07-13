import { BadRequestException } from '@nestjs/common';

export const maxFileNameBytes = 255;

const invalidFileNameCharacters = /[<>:"/\\|?*]/;
const windowsReservedNames = new Set([
  'aux',
  'con',
  'nul',
  'prn',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
  ...['¹', '²', '³'].flatMap((digit) => [`com${digit}`, `lpt${digit}`]),
]);

export function normalizeFileName(value: string) {
  if (hasMalformedUnicode(value)) {
    throw new BadRequestException('File name contains malformed Unicode');
  }
  const name = value.normalize('NFC').trim();
  if (!name) throw new BadRequestException('File name is required');
  if (name === '.' || name === '..') {
    throw new BadRequestException('File name is not valid');
  }
  if (invalidFileNameCharacters.test(name) || hasControlCharacter(name)) {
    throw new BadRequestException('File name contains invalid characters');
  }
  if (/[. ]$/.test(name)) {
    throw new BadRequestException('File name cannot end with a space or dot');
  }
  if (
    getFileNameBase(name) &&
    windowsReservedNames.has(getFileNameBase(name))
  ) {
    throw new BadRequestException('File name is reserved');
  }
  if (Buffer.byteLength(name, 'utf8') > maxFileNameBytes) {
    throw new BadRequestException('File name is too long');
  }
  return name;
}

export function getFileNameConflictKey(value: string) {
  return value.normalize('NFC').trim().toLowerCase();
}

export function createFileNodeStorageKeys(input: {
  archived: boolean;
  id: string;
  name: string;
  ownerUserId: string | null | undefined;
  parentNodeId: string | null | undefined;
  spaceScope: string;
}) {
  const ownerUserId = input.ownerUserId ?? '';
  if (input.spaceScope === 'personal' && !ownerUserId.trim()) {
    throw new BadRequestException('Personal files require an owner');
  }
  return {
    directoryKey: input.parentNodeId ?? '',
    nameKey: input.archived
      ? `archived:${input.id}`
      : `active:${getFileNameConflictKey(input.name)}`,
    ownerScopeKey: input.spaceScope === 'personal' ? ownerUserId : '',
  };
}

export function createSuffixedFileName(value: string, suffix: string) {
  const name = normalizeFileName(value);
  const dotIndex = name.lastIndexOf('.');
  const hasExtension = dotIndex > 0 && dotIndex < name.length - 1;
  const baseName = hasExtension ? name.slice(0, dotIndex) : name;
  const extension = hasExtension ? name.slice(dotIndex) : '';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  if (suffixBytes >= maxFileNameBytes) {
    throw new BadRequestException('File name suffix exceeds the length limit');
  }
  const reservedBytes = suffixBytes + Buffer.byteLength(extension, 'utf8');
  const baseByteLimit = maxFileNameBytes - reservedBytes;
  if (baseByteLimit < 1) {
    const truncatedName = truncateUtf8(
      name,
      maxFileNameBytes - suffixBytes,
    ).trimEnd();
    return normalizeFileName(`${truncatedName}${suffix}`);
  }
  const truncatedBaseName = truncateUtf8(baseName, baseByteLimit);
  return normalizeFileName(`${truncatedBaseName}${suffix}${extension}`);
}

export function createAttachmentContentDisposition(filename: string) {
  return createContentDisposition('attachment', filename);
}

export function createInlineContentDisposition(filename: string) {
  return createContentDisposition('inline', filename);
}

function createContentDisposition(
  disposition: 'attachment' | 'inline',
  filename: string,
) {
  const safeName = sanitizeDownloadFileName(filename);
  const fallbackName = createAsciiFallbackFileName(safeName);
  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeContentDispositionValue(safeName)}`;
}

function getFileNameBase(name: string) {
  const dotIndex = name.indexOf('.');
  return (dotIndex === -1 ? name : name.slice(0, dotIndex))
    .trim()
    .toLowerCase();
}

function sanitizeDownloadFileName(filename: string) {
  const normalized = replaceMalformedUnicode(filename).normalize('NFC').trim();
  const safeName = replaceUnsafeDownloadNameCharacters(normalized);
  if (!safeName || safeName === '.' || safeName === '..') return 'download';
  return truncateUtf8(safeName, maxFileNameBytes);
}

function createAsciiFallbackFileName(filename: string) {
  const fallback = filename
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        code < 32 ||
        code === 127 ||
        code > 126 ||
        character === '"' ||
        character === '\\' ||
        character === ';'
      ) {
        return '_';
      }
      return character;
    })
    .join('')
    .trim();
  if (!fallback || fallback === '.' || fallback === '..') return 'download';
  return fallback;
}

function encodeContentDispositionValue(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return isControlCharacterCode(code);
  });
}

function isControlCharacterCode(code: number) {
  return code < 32 || (code >= 127 && code <= 159);
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

function replaceMalformedUnicode(value: string) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += '_';
      }
      continue;
    }
    result += code >= 0xdc00 && code <= 0xdfff ? '_' : value[index];
  }
  return result;
}

function replaceUnsafeDownloadNameCharacters(value: string) {
  return [...value]
    .map((character) => {
      if (character === '/' || character === '\\') return '_';
      const code = character.charCodeAt(0);
      return isControlCharacterCode(code) ? '_' : character;
    })
    .join('');
}

function truncateUtf8(value: string, maxBytes: number) {
  let result = '';
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
}
