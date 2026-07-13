import {
  createFileNodeStorageKeys,
  createAttachmentContentDisposition,
  createSuffixedFileName,
  maxFileNameBytes,
  normalizeFileName,
} from './file-name-policy';

describe('file name policy', () => {
  it('creates stable lifecycle-aware storage keys for name uniqueness', () => {
    expect(
      createFileNodeStorageKeys({
        archived: false,
        id: 'node-1',
        name: 'Résumé.pdf',
        ownerUserId: 'user-1',
        parentNodeId: null,
        spaceScope: 'personal',
      }),
    ).toEqual({
      directoryKey: '',
      nameKey: 'active:résumé.pdf',
      ownerScopeKey: 'user-1',
    });
    expect(
      createFileNodeStorageKeys({
        archived: true,
        id: 'node-1',
        name: 'Résumé.pdf',
        ownerUserId: null,
        parentNodeId: 'folder-1',
        spaceScope: 'workspace',
      }),
    ).toEqual({
      directoryKey: 'folder-1',
      nameKey: 'archived:node-1',
      ownerScopeKey: '',
    });
  });

  it('requires an owner for personal file name keys', () => {
    expect(() =>
      createFileNodeStorageKeys({
        archived: false,
        id: 'node-1',
        name: 'Report.txt',
        ownerUserId: null,
        parentNodeId: null,
        spaceScope: 'personal',
      }),
    ).toThrow('Personal files require an owner');
  });

  it('trims and normalizes valid file names', () => {
    expect(normalizeFileName('  Customer Notes.pdf  ')).toBe(
      'Customer Notes.pdf',
    );
  });

  it('rejects path traversal, separators, reserved names, and unsafe endings', () => {
    expect(() => normalizeFileName('..')).toThrow();
    expect(() => normalizeFileName('folder/report.pdf')).toThrow();
    expect(() =>
      normalizeFileName(`report${String.fromCharCode(0x85)}.pdf`),
    ).toThrow();
    expect(() => normalizeFileName('CON.txt')).toThrow();
    expect(() => normalizeFileName('report.')).toThrow();
  });

  it('rejects Windows reserved names that use superscript digits', () => {
    expect(() => normalizeFileName('COM¹.txt')).toThrow();
    expect(() => normalizeFileName('LPT³')).toThrow();
  });

  it('rejects file names beyond the maximum length', () => {
    expect(() => normalizeFileName('a'.repeat(maxFileNameBytes + 1))).toThrow();
  });

  it('enforces the file name limit in UTF-8 bytes', () => {
    expect(normalizeFileName('界'.repeat(85))).toBe('界'.repeat(85));
    expect(() => normalizeFileName('界'.repeat(86))).toThrow();
  });

  it('rejects malformed Unicode file names', () => {
    expect(() =>
      normalizeFileName(`broken-${String.fromCharCode(0xd800)}.txt`),
    ).toThrow();
    expect(() =>
      normalizeFileName(`broken-${String.fromCharCode(0xdc00)}.txt`),
    ).toThrow();
    expect(() =>
      normalizeFileName(`broken-${String.fromCharCode(0xd800)}`),
    ).toThrow();
  });

  it('keeps suffixes visible when an unusually long extension fills the limit', () => {
    const name = `a.${'x'.repeat(253)}`;
    const suffixedName = createSuffixedFileName(name, ' (2)');

    expect(Buffer.byteLength(name, 'utf8')).toBe(maxFileNameBytes);
    expect(Buffer.byteLength(suffixedName, 'utf8')).toBeLessThanOrEqual(
      maxFileNameBytes,
    );
    expect(suffixedName.endsWith(' (2)')).toBe(true);
    expect(createSuffixedFileName('report.pdf', ' (2)')).toBe('report (2).pdf');
  });

  it('creates safe attachment headers with utf-8 file names', () => {
    expect(createAttachmentContentDisposition('季度 报告"v1".pdf')).toBe(
      'attachment; filename="__ ___v1_.pdf"; filename*=UTF-8\'\'%E5%AD%A3%E5%BA%A6%20%E6%8A%A5%E5%91%8A%22v1%22.pdf',
    );
  });

  it('creates safe attachment headers for legacy malformed Unicode names', () => {
    expect(
      createAttachmentContentDisposition(
        `broken-${String.fromCharCode(0xd800)}.txt`,
      ),
    ).toBe(
      'attachment; filename="broken-_.txt"; filename*=UTF-8\'\'broken-_.txt',
    );
  });
});
