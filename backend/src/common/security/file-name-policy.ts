import { BadRequestException } from '@nestjs/common';

export const maxFileNameLength = 255;

const invalidFileNameCharacters = /[<>:"/\\|?*]/;
const windowsReservedNames = new Set([
  'aux',
  'con',
  'nul',
  'prn',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

export function normalizeFileName(value: string) {
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
  if ([...name].length > maxFileNameLength) {
    throw new BadRequestException(
      `File name cannot exceed ${maxFileNameLength} characters`,
    );
  }
  return name;
}

export function getFileNameConflictKey(value: string) {
  return value.normalize('NFC').trim().toLocaleLowerCase();
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
    .toLocaleLowerCase();
}

function sanitizeDownloadFileName(filename: string) {
  const normalized = filename.normalize('NFC').trim();
  const safeName = replaceUnsafeDownloadNameCharacters(normalized);
  if (!safeName || safeName === '.' || safeName === '..') return 'download';
  return [...safeName].slice(0, maxFileNameLength).join('');
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
    return code < 32 || code === 127;
  });
}

function replaceUnsafeDownloadNameCharacters(value: string) {
  return [...value]
    .map((character) => {
      if (character === '/' || character === '\\') return '_';
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? '_' : character;
    })
    .join('');
}
