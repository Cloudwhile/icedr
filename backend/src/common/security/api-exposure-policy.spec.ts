import { shouldExposeApiDocs } from './api-exposure-policy';

describe('shouldExposeApiDocs', () => {
  it('never exposes Swagger in production', () => {
    expect(shouldExposeApiDocs(true)).toBe(false);
  });

  it('keeps Swagger available for local development', () => {
    expect(shouldExposeApiDocs(false)).toBe(true);
  });
});
