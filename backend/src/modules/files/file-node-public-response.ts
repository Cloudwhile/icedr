import type { FileNodeResponse } from './file-nodes.dto';

export type PublicFileNodeResponse<
  T extends FileNodeResponse = FileNodeResponse,
> = Omit<T, 'objectKey'> & {
  hasContent: boolean;
};

export function toPublicFileNode<T extends FileNodeResponse>(
  node: T,
): PublicFileNodeResponse<T> {
  const { objectKey, ...publicNode } = node;
  return {
    ...publicNode,
    hasContent: Boolean(objectKey),
  };
}
