import { getDriveFileNameConflictKey } from "@/features/file/file-name-policy";

export type UploadConflictResolutionStrategy =
  | "overwrite"
  | "rename"
  | "skip"
  | "version";

export type UploadConflictGroup<T> = {
  canonicalName: string;
  files: T[];
  hasExistingConflict: boolean;
};

export type UploadConflictAnalysis<T> = {
  conflictingFiles: T[];
  groups: UploadConflictGroup<T>[];
};

export type UploadConflictPlan<T> = {
  skippedFiles: T[];
  uploadGroups: T[][];
};

export function analyzeUploadConflicts<T extends { name: string }>(
  files: readonly T[],
  existingNames: Iterable<string>,
): UploadConflictAnalysis<T> {
  const existingKeys = new Set(
    Array.from(existingNames, (name) => getDriveFileNameConflictKey(name)),
  );
  const filesByCanonicalName = new Map<string, T[]>();

  files.forEach((file) => {
    const canonicalName = getDriveFileNameConflictKey(file.name);
    const group = filesByCanonicalName.get(canonicalName);
    if (group) {
      group.push(file);
    } else {
      filesByCanonicalName.set(canonicalName, [file]);
    }
  });

  const groups = Array.from(filesByCanonicalName, ([canonicalName, groupedFiles]) => ({
    canonicalName,
    files: groupedFiles,
    hasExistingConflict: existingKeys.has(canonicalName),
  }));

  return {
    conflictingFiles: groups.flatMap((group) => (
      group.hasExistingConflict || group.files.length > 1 ? group.files : []
    )),
    groups,
  };
}

export function planUploadConflictResolution<T>(
  analysis: UploadConflictAnalysis<T>,
  strategy: UploadConflictResolutionStrategy,
): UploadConflictPlan<T> {
  if (strategy !== "skip") {
    return {
      skippedFiles: [],
      uploadGroups: analysis.groups.map((group) => [...group.files]),
    };
  }

  const skippedFiles: T[] = [];
  const uploadGroups: T[][] = [];

  analysis.groups.forEach((group) => {
    if (group.hasExistingConflict) {
      skippedFiles.push(...group.files);
      return;
    }

    const [firstFile, ...duplicateFiles] = group.files;
    if (firstFile) uploadGroups.push([firstFile]);
    skippedFiles.push(...duplicateFiles);
  });

  return { skippedFiles, uploadGroups };
}

export async function runUploadGroups<T>(
  groups: readonly (readonly T[])[],
  start: (item: T) => Promise<unknown> | void,
) {
  await Promise.all(groups.map(async (group) => {
    for (const item of group) {
      try {
        await start(item);
      } catch {
        // A failed item must not prevent the remaining items in its canonical-name group.
      }
    }
  }));
}
