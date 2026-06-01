import { getItemExtension, getItemKind, type DriveItem, type LocalIconName } from "./model";

export type FileOpenWithApp = "image" | "markdown" | "office" | "text" | "video";

export type FileOpenWithOption = {
  icon: LocalIconName;
  labelKey: string;
  value: FileOpenWithApp;
};

const textEditableExtensions = ["txt", "json", "csv", "log", "yaml", "yml"];
const markdownExtensions = ["md", "markdown"];
const officePreviewExtensions = ["docx", "pdf"];
const videoPreviewExtensions = ["mp4", "webm", "mov", "m4v", "ogv"];

export function isTextEditableFile(item: DriveItem) {
  const extension = getItemExtension(item);
  return Boolean(
    item.mimeType?.startsWith("text/") ||
      textEditableExtensions.includes(extension) ||
      markdownExtensions.includes(extension),
  );
}

export function isMarkdownFile(item: DriveItem) {
  return markdownExtensions.includes(getItemExtension(item));
}

export function isOfficePreviewFile(item: DriveItem) {
  return officePreviewExtensions.includes(getItemExtension(item));
}

export function isVideoPreviewFile(item: DriveItem) {
  const extension = getItemExtension(item);
  return Boolean(item.mimeType?.startsWith("video/") || videoPreviewExtensions.includes(extension));
}

export function isImagePreviewFile(item: DriveItem) {
  return getItemKind(item) === "image" || Boolean(item.mimeType?.startsWith("image/"));
}

export function getFileOpenWithStorageKey(item: DriveItem) {
  const extension = getItemExtension(item);
  return `icedr.preview.openWith.${extension || getItemKind(item)}`;
}

export function getDefaultFileOpenWith(item: DriveItem): FileOpenWithApp {
  if (isMarkdownFile(item)) return "markdown";
  if (isTextEditableFile(item)) return "text";
  if (isImagePreviewFile(item)) return "image";
  if (isVideoPreviewFile(item)) return "video";
  return "office";
}

export function getFileOpenWithOptions(item: DriveItem): FileOpenWithOption[] {
  if (isMarkdownFile(item)) {
    return [
      { icon: "document", labelKey: "preview.markdown", value: "markdown" },
      { icon: "document", labelKey: "preview.plainText", value: "text" },
    ];
  }

  if (isTextEditableFile(item)) {
    return [{ icon: "document", labelKey: "preview.plainText", value: "text" }];
  }

  if (isImagePreviewFile(item)) {
    return [{ icon: "image", labelKey: "files.kind.image", value: "image" }];
  }

  if (isVideoPreviewFile(item)) {
    return [{ icon: "visible", labelKey: "files.kind.video", value: "video" }];
  }

  if (isOfficePreviewFile(item)) {
    return [{ icon: "visible", labelKey: "files.kind.doc", value: "office" }];
  }

  return [];
}
