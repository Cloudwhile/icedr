import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getServiceIndex() {
    return {
      name: 'ICEDR API',
      architecture: 'NestJS Monolith',
      phase: 'Phase 1',
      modules: [
        'auth',
        'identity',
        'workspaces',
        'file-nodes',
        'shares',
        'audit',
        'storage',
        'queue',
        'worker',
      ],
      docs: '/api/docs',
      health: '/api/health',
    };
  }
}
