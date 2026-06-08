import { getItemExtension, getItemKind, type DriveItem, type LocalIconName } from "./model";
import type { PreviewRenderMode } from "@/lib/drive-api";

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

export function getPreviewRenderMode(item: DriveItem): PreviewRenderMode {
  return item.previewCapability?.renderMode ?? getLegacyPreviewRenderMode(item);
}

export function isDownloadOnlyFile(item: DriveItem) {
  return Boolean(item.previewCapability?.downloadOnly);
}

export function canOpenFilePreview(item: DriveItem) {
  return getFileOpenWithOptions(item).length > 0;
}

export function isFileOpenWithAvailable(item: DriveItem, openWith: FileOpenWithApp | null | undefined) {
  if (!openWith) return false;
  return getFileOpenWithOptions(item).some((option) => option.value === openWith);
}

export function isTextEditableFile(item: DriveItem) {
  if (item.previewCapability) {
    return Boolean(
      item.previewCapability.supported &&
        (item.previewCapability.renderMode === "markdown" || item.previewCapability.renderMode === "text"),
    );
  }

  const extension = getItemExtension(item);
  return Boolean(
    item.mimeType?.startsWith("text/") ||
      textEditableExtensions.includes(extension) ||
      markdownExtensions.includes(extension),
  );
}

export function isMarkdownFile(item: DriveItem) {
  if (item.previewCapability) {
    return Boolean(item.previewCapability.supported && item.previewCapability.renderMode === "markdown");
  }

  return markdownExtensions.includes(getItemExtension(item));
}

export function isOfficePreviewFile(item: DriveItem) {
  if (item.previewCapability) {
    return Boolean(
      item.previewCapability.supported &&
        (item.previewCapability.renderMode === "docx" || item.previewCapability.renderMode === "pdf"),
    );
  }

  return officePreviewExtensions.includes(getItemExtension(item));
}

export function isVideoPreviewFile(item: DriveItem) {
  if (item.previewCapability) {
    return Boolean(item.previewCapability.supported && item.previewCapability.renderMode === "video");
  }

  const extension = getItemExtension(item);
  return Boolean(item.mimeType?.startsWith("video/") || videoPreviewExtensions.includes(extension));
}

export function isImagePreviewFile(item: DriveItem) {
  if (item.previewCapability) {
    return Boolean(item.previewCapability.supported && item.previewCapability.renderMode === "image");
  }

  return getItemKind(item) === "image" || Boolean(item.mimeType?.startsWith("image/"));
}

export function getFileOpenWithStorageKey(item: DriveItem) {
  const extension = getItemExtension(item);
  return `icedr.preview.openWith.${extension || getItemKind(item)}`;
}

export function getDefaultFileOpenWith(item: DriveItem): FileOpenWithApp {
  if (item.previewCapability) {
    switch (item.previewCapability.renderMode) {
      case "markdown":
        return "markdown";
      case "text":
        return "text";
      case "image":
        return "image";
      case "video":
        return "video";
      case "docx":
      case "pdf":
      default:
        return "office";
    }
  }

  if (isMarkdownFile(item)) return "markdown";
  if (isTextEditableFile(item)) return "text";
  if (isImagePreviewFile(item)) return "image";
  if (isVideoPreviewFile(item)) return "video";
  return "office";
}

export function getFileOpenWithOptions(item: DriveItem): FileOpenWithOption[] {
  if (item.previewCapability) {
    if (!item.previewCapability.supported) return [];

    switch (item.previewCapability.renderMode) {
      case "markdown":
        return [
          { icon: "document", labelKey: "preview.markdown", value: "markdown" },
          { icon: "document", labelKey: "preview.plainText", value: "text" },
        ];
      case "text":
        return [{ icon: "document", labelKey: "preview.plainText", value: "text" }];
      case "image":
        return [{ icon: "image", labelKey: "files.kind.image", value: "image" }];
      case "video":
        return [{ icon: "visible", labelKey: "files.kind.video", value: "video" }];
      case "docx":
      case "pdf":
        return [{ icon: "visible", labelKey: "files.kind.doc", value: "office" }];
      default:
        return [];
    }
  }

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

function getLegacyPreviewRenderMode(item: DriveItem): PreviewRenderMode {
  if (isMarkdownFile(item)) return "markdown";
  if (isTextEditableFile(item)) return "text";
  if (isImagePreviewFile(item)) return "image";
  if (isVideoPreviewFile(item)) return "video";

  const extension = getItemExtension(item);
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  return "download-only";
}
