import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service';

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('DatabaseService', () => {
  it('rejects startup without database connection fields', () => {
    expect(
      () =>
        new DatabaseService(
          config({
            'database.configured': false,
          }),
        ),
    ).toThrow('DATABASE_HOST');
  });

  it('creates a PostgreSQL-backed service when database config is complete', async () => {
    const service = new DatabaseService(
      config({
        'database.configured': true,
        'database.host': 'localhost',
        'database.port': 5432,
        'database.dbName': 'icedr',
        'database.user': 'icedr',
        'database.password': 'secret',
      }),
    );

    const query = service.query.bind(service);
    expect(query).toEqual(expect.any(Function));
    await service.onModuleDestroy();
  });
});
