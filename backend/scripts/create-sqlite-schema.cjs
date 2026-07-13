const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(backendRoot, '..');
const postgresSchemaPath = path.join(workspaceRoot, 'database', 'schema.prisma');
const sqliteSchemaPath = path.join(workspaceRoot, 'database', 'schema.sqlite.prisma');

function createSqliteSchema(source) {
  return source
    .replace(
      /output\s+= "\.\.\/backend\/src\/generated\/prisma"/,
      'output       = "../backend/src/generated/prisma-sqlite"',
    )
    .replace(/provider = "postgresql"/, 'provider = "sqlite"')
    .replace(/ @db\.Timestamptz/g, '')
    .replace(/ @db\.Decimal\(5, 1\)/g, '')
    .replace(
      /Json(\s+)@default\("(\{\}|\[\])"\)/g,
      (_match, spacing, value) => `Json${spacing}@default(dbgenerated("'${value}'"))`,
    )
    .replace(
      /(\b(?:directoryKey|ownerScopeKey|nameKey)\s+String\s+)(@map\("(?:directory_key|owner_scope_key|name_key)"\))/g,
      '$1@default("") $2',
    );
}

function writeSqliteSchema() {
  const source = fs.readFileSync(postgresSchemaPath, 'utf8');
  const sqliteSchema = createSqliteSchema(source);
  fs.writeFileSync(sqliteSchemaPath, sqliteSchema, 'utf8');
  return sqliteSchemaPath;
}

if (require.main === module) {
  writeSqliteSchema();
}

module.exports = {
  createSqliteSchema,
  writeSqliteSchema,
};
