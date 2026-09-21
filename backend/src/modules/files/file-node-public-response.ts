import type { FileNodeResponse } from './file-nodes.dto';

export type PublicFileNodeResponse<
  T extends FileNodeResponse = FileNodeResponse,
> = Omit<T, 'objectKey' | 'checksumValue' | 'verificationFailureCode'> & {
  hasContent: boolean;
};

export function toPublicFileNode<T extends FileNodeResponse>(
  node: T,
): PublicFileNodeResponse<T> {
  const { objectKey, checksumValue, verificationFailureCode, ...publicNode } =
    node;
  void checksumValue;
  void verificationFailureCode;
  return {
    ...publicNode,
    hasContent: Boolean(objectKey),
  };
}
