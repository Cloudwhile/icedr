# PostgreSQL 配置

PostgreSQL 适合需要独立备份、监控和数据库运维的环境。ICEDR 当前支持在首次初始化向导中从新的 SQLite 数据源迁移到 PostgreSQL；已经完成初始化的实例不应通过手工改表或直接切换连接来迁移。

## 创建数据库和账号

以 PostgreSQL 管理员身份执行：

```sql
CREATE ROLE icedr_app WITH LOGIN PASSWORD '使用独立强密码';
CREATE DATABASE icedr OWNER icedr_app ENCODING 'UTF8';
REVOKE ALL ON DATABASE icedr FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE icedr TO icedr_app;
```

数据库应为空或专用于 ICEDR。不要与其他应用共用 schema 和账号。

## 网络与 TLS

- 只允许 ICEDR 主机或容器网络连接 `5432`。
- 优先使用内网 DNS 名称，不把数据库直接暴露到公网。
- 托管数据库按供应商要求启用 TLS 和 CA 校验。
- 设置连接数、磁盘和备份告警。

## 环境变量

```dotenv
DATABASE_HOST=postgres.internal.your-domain.tld
DATABASE_PORT=5432
DATABASE_DBNAME=icedr
DATABASE_USER=icedr_app
DATABASE_PASSWORD=填写独立强密码
```

Docker Compose 中可以把主机名设为 PostgreSQL 服务名。生产校验会拒绝常见占位密码和示例域名，复制后必须替换。

## 首次初始化时迁移

1. 先备份当前全新实例的数据目录。
2. 在初始化向导的数据库步骤选择 PostgreSQL。
3. 填写连接信息。
4. 选择“验证并迁移”。
5. 确认验证成功后继续初始化。
6. 完成后重启实例，确认仍连接到同一个 PostgreSQL 数据库。

向导会部署数据库迁移并复制当前数据。迁移期间不要让其他实例同时写入源 SQLite。

## 启动迁移

已配置 PostgreSQL 的实例启动时会执行兼容的数据库迁移。升级时：

- 只启动一个新版本实例执行迁移。
- 等待日志确认启动完成后再恢复流量。
- 不要让旧版本和新版本同时写入正在升级的数据库。
- 需要回滚时恢复升级前备份，而不是直接用旧程序连接已升级结构。

## 备份

使用自定义格式导出：

```bash
pg_dump \
  --format=custom \
  --no-owner \
  --file=icedr-$(date +%F-%H%M).dump \
  --host=postgres.internal.your-domain.tld \
  --username=icedr_app \
  icedr
```

恢复到新的空数据库：

```bash
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --host=postgres.internal.your-domain.tld \
  --username=icedr_app \
  --dbname=icedr_restore_test \
  icedr-YYYY-MM-DD-HHMM.dump
```

密码不要直接写入命令历史。使用 `.pgpass`、临时受保护环境或备份系统的凭据管理。

## 验证恢复

恢复测试至少确认：

- 管理员可以登录。
- 工作区、文件元数据和分享数量符合预期。
- 与同一时间点恢复的本地文件或对象存储能够对应。
- 审计记录时间连续。
- 上传和下载一个新测试文件成功。

数据库和文件对象的联合恢复见 [备份与恢复](/deployment/backup-restore)。
