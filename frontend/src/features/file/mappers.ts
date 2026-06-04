import type { FileNodeResponse } from "@/lib/drive-api";
import type { DriveItem } from "./model";

export function mapFileNodeToDriveItem(node: FileNodeResponse): DriveItem {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    workspaceId: node.workspaceId,
    parentId: node.parentNodeId,
    owner: node.owner,
    createdAt: node.createdAt,
    modifiedAt: node.updatedAt,
    mimeType: node.mimeType,
    objectKey: node.objectKey,
    sizeBytes: node.sizeBytes,
    shared: false,
    starred: node.starred,
    archivedAt: node.archivedAt,
    archivedBy: node.archivedBy,
    originalParentNodeId: node.originalParentNodeId,
    originalPath: node.originalPath,
    searchPath: "path" in node && typeof node.path === "string" ? node.path : null,
    previewCapability: node.previewCapability,
    colorKey: node.kind === "sheet" ? "success" : node.kind === "image" || node.kind === "video" ? "secure" : node.kind === "archive" ? "tertiary" : "primary",
  };
}
