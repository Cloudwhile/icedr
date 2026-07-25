import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { ShareContentMemberSnapshot } from './share-content.types';

@Injectable()
export class ShareContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  listMembers(shareToken: string) {
    return this.prisma.shareContentMember.findMany({
      where: { shareToken },
      orderBy: [{ createdAt: 'asc' }, { nodeId: 'asc' }],
    });
  }

  findMember(shareToken: string, nodeId: string) {
    return this.prisma.shareContentMember.findUnique({
      where: { shareToken_nodeId: { shareToken, nodeId } },
    });
  }

  createMembersIfMissing(
    shareToken: string,
    members: ShareContentMemberSnapshot[],
  ) {
    if (members.length === 0) return Promise.resolve({ count: 0 });
    return this.prisma.shareContentMember.createMany({
      data: members.map((member) => ({ shareToken, ...member })),
      skipDuplicates: true,
    });
  }
}
