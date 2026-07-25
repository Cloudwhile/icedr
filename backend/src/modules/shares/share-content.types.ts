import type { FileNodeResponse } from '../files/file-nodes.dto';
import type {
  CreateShareDto,
  ShareContentMemberRole,
  ShareContentScopeMode,
  ShareMode,
} from './shares.dto';

export type NormalizedCreateShareDto = Omit<
  CreateShareDto,
  | 'allowedItemIds'
  | 'dynamicRootId'
  | 'mode'
  | 'owner'
  | 'rootItemIds'
  | 'title'
> & {
  allowedItemIds: string[];
  dynamicRootId: string | null;
  mode: ShareMode;
  owner: string;
  rootItemIds: string[];
  scopeMode: ShareContentScopeMode;
  title: string;
};

export type ShareContentMemberSnapshot = {
  nodeId: string;
  role: ShareContentMemberRole;
  snapshotKind: string | null;
  snapshotMimeType: string | null;
  snapshotName: string | null;
  snapshotParentNodeId: string | null;
  snapshotSizeBytes: bigint | null;
};

export type ResolvedShareCreateScope = {
  dto: NormalizedCreateShareDto;
  members: ShareContentMemberSnapshot[];
};

export type ShareCreatorAccess = {
  actorRole?: string;
  actorUserId?: string;
};

export type ResolvedShareContentNode = {
  member: ShareContentMemberSnapshot;
  node: FileNodeResponse | null;
};
