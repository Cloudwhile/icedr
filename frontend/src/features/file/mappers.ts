import type { FileNodeResponse } from "@/lib/drive-api";
import type { DriveItem } from "./model";

export function mapFileNodeToDriveItem(node: FileNodeResponse): DriveItem {
  return {
    id: node.id,
    name: node.name,
    workspaceId: node.workspaceId,
    parentId: node.parentNodeId,
    owner: node.owner,
    modifiedAt: node.updatedAt,
    mimeType: node.mimeType,
    objectKey: node.objectKey,
    sizeBytes: node.sizeBytes,
    shared: false,
    starred: node.starred,
    archivedAt: node.archivedAt,
    colorKey: node.kind === "sheet" ? "success" : node.kind === "image" ? "secure" : node.kind === "archive" ? "tertiary" : "primary",
  };
}
