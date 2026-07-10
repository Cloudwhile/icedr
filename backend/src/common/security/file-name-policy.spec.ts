import {
  createAttachmentContentDisposition,
  maxFileNameLength,
  normalizeFileName,
} from './file-name-policy';

describe('file name policy', () => {
  it('trims and normalizes valid file names', () => {
    expect(normalizeFileName('  Customer Notes.pdf  ')).toBe(
      'Customer Notes.pdf',
    );
  });

  it('rejects path traversal, separators, reserved names, and unsafe endings', () => {
    expect(() => normalizeFileName('..')).toThrow();
    expect(() => normalizeFileName('folder/report.pdf')).toThrow();
    expect(() => normalizeFileName('CON.txt')).toThrow();
    expect(() => normalizeFileName('report.')).toThrow();
  });

  it('rejects file names beyond the maximum length', () => {
    expect(() =>
      normalizeFileName('a'.repeat(maxFileNameLength + 1)),
    ).toThrow();
  });

  it('creates safe attachment headers with utf-8 file names', () => {
    expect(createAttachmentContentDisposition('季度 报告"v1".pdf')).toBe(
      'attachment; filename="__ ___v1_.pdf"; filename*=UTF-8\'\'%E5%AD%A3%E5%BA%A6%20%E6%8A%A5%E5%91%8A%22v1%22.pdf',
    );
  });
});
