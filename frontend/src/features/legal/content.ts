import type { Locale } from "@/features/file/model";

export type LegalDocumentKey = "terms" | "privacy";
export type LegalTextLocale = "zh" | "en";

export type LegalSectionDescriptor = {
  bodyCount: number;
  index: number;
};

export type LegalDocumentDescriptor = {
  introCount: number;
  key: LegalDocumentKey;
  route: string;
  sections: LegalSectionDescriptor[];
};

const sectionBodyCounts = {
  privacy: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  terms: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
} satisfies Record<LegalDocumentKey, number[]>;

export const legalDocuments: Record<LegalDocumentKey, LegalDocumentDescriptor> = {
  privacy: createLegalDocument("privacy", "/privacy"),
  terms: createLegalDocument("terms", "/terms"),
};

function createLegalDocument(key: LegalDocumentKey, route: string): LegalDocumentDescriptor {
  return {
    introCount: 2,
    key,
    route,
    sections: sectionBodyCounts[key].map((bodyCount, index) => ({
      bodyCount,
      index,
    })),
  };
}

export function getLegalDocument(key: LegalDocumentKey) {
  return legalDocuments[key];
}

export function getLegalTextLocale(locale: Locale): LegalTextLocale {
  return locale === "zh" || locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function getLegalDocumentLabelKey(key: LegalDocumentKey, language: LegalTextLocale) {
  return `legal.documents.${key}.${language}.label`;
}

export function getLegalDocumentTitleKey(key: LegalDocumentKey, language: LegalTextLocale) {
  return `legal.documents.${key}.${language}.title`;
}

export function getLegalDocumentSubtitleKey(key: LegalDocumentKey, language: LegalTextLocale) {
  return `legal.documents.${key}.${language}.subtitle`;
}

export function getLegalDocumentEffectiveDateKey(key: LegalDocumentKey, language: LegalTextLocale) {
  return `legal.documents.${key}.${language}.effectiveDate`;
}

export function getLegalDocumentIntroKey(key: LegalDocumentKey, language: LegalTextLocale, index: number) {
  return `legal.documents.${key}.${language}.intro.${index}`;
}

export function getLegalDocumentSectionTitleKey(key: LegalDocumentKey, language: LegalTextLocale, sectionIndex: number) {
  return `legal.documents.${key}.${language}.sections.${sectionIndex}.title`;
}

export function getLegalDocumentSectionBodyKey(key: LegalDocumentKey, language: LegalTextLocale, sectionIndex: number, bodyIndex: number) {
  return `legal.documents.${key}.${language}.sections.${sectionIndex}.body.${bodyIndex}`;
}
