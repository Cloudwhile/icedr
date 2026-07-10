# 配置说明

ICEDR 使用环境变量、初始化向导和管理员设置共同完成配置。环境变量负责实例启动和外部基础设施，向导负责首次引导，管理员设置负责运行后的产品策略。

## 配置层次

| 层次 | 适合内容 | 示例 |
| --- | --- | --- |
| 环境变量 | 启动前必须确定、凭据或基础设施地址 | 监听端口、安全密钥、数据库、对象存储 |
| 初始化向导 | 首次建立可用实例 | 管理员、数据库验证、登录方式、邮件、存储、站点名称 |
| 管理员设置 | 运行中的产品策略 | OAuth Provider、Passkey、配额、生命周期、外链规则 |

管理员设置保存到数据库。迁移或恢复实例时，数据库与环境文件必须一起保护。

## 生产 `.env` 模板

下面模板适合 Docker `--env-file` 或二进制服务环境文件。尖括号为必填占位符，启动前需要替换为真实值。

```dotenv
# 运行模式
NODE_ENV=production
APP_ENV=production
API_HOST=0.0.0.0
API_PORT=13000

# 必填：使用 openssl rand -hex 32 生成并长期保存
AUTH_SECURITY_SECRET=<生成至少32字符的随机值>

# 正式访问地址
API_CORS_ORIGIN=https://drive.your-domain.tld
API_PUBLIC_BASE_URL=https://drive.your-domain.tld/api
PUBLIC_SHARE_BASE_URL=https://drive.your-domain.tld/share/s

# 数据目录与本地文件
ICEDR_DATA_DIR=/workspace/backend/data
SQLITE_DATABASE_PATH=/workspace/backend/data/icedr.sqlite
LOCAL_STORAGE_ROOT=/workspace/backend/data/local-files

# 邮件暂时关闭；启用时填写后面的 SMTP 项
SMTP_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_NAME=ICEDR
SMTP_FROM_EMAIL=
SMTP_REPLY_TO=

# PostgreSQL，可选；五项完整时启用
DATABASE_HOST=
DATABASE_PORT=5432
DATABASE_DBNAME=
DATABASE_USER=
DATABASE_PASSWORD=

# S3 / MinIO，可选
S3_ENDPOINT=
S3_PUBLIC_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=icedr-drive
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true

# Redis，可选
REDIS_HOST=
REDIS_PORT=6379
REDIS_DBNAME=0
REDIS_USER=
REDIS_PASSWORD=
```

`.env` 文件不一定会执行命令替换。先单独运行 `openssl rand -hex 32`，再把结果粘贴为实际值。文件权限建议为 `0600`。

## 最小生产配置

生产模式至少需要：

- `NODE_ENV=production` 和 `APP_ENV=production`。
- 有效的 `API_HOST` 与 `API_PORT`。
- 至少 32 字符的 `AUTH_SECURITY_SECRET`。
- 持久化数据目录。
- SMTP 关闭或提供完整有效的 SMTP 配置。

使用公网域名时，再设置 CORS、公开服务地址和外链地址。使用 SQLite 与本地存储时，不需要配置 PostgreSQL、Redis 或 S3。

## 安全密钥

`AUTH_SECURITY_SECRET` 用于认证安全状态，必须：

- 使用密码学安全随机值。
- 在所有同一实例进程中保持一致。
- 随备份恢复，不在升级时重新生成。
- 不写入镜像、代码仓库、工单或公开日志。

更换该值会使已有认证会话失效。需要轮换时，应安排用户重新登录并保留回滚方案。

`SHARE_VISITOR_HASH_SECRET` 可用于外链访客标识保护。正式开放匿名分享时建议单独设置随机值，不与认证密钥复用。

## 数据库

没有完整 PostgreSQL 配置时，ICEDR 使用 SQLite。

SQLite 相关变量：

| 变量 | 默认或用途 |
| --- | --- |
| `ICEDR_DATA_DIR` | 二进制或后端数据根目录 |
| `SQLITE_DATABASE_PATH` | SQLite 文件位置，默认位于数据目录 |

PostgreSQL 需要同时提供主机、端口、数据库名、用户和密码。具体创建与恢复流程见 [PostgreSQL 配置](/deployment/postgresql)。

## 文件存储

没有对象存储配置时，文件写入 `LOCAL_STORAGE_ROOT`。

S3 / MinIO 需要 Endpoint、Region、Bucket、Access Key 和 Secret Key。MinIO 通常启用 `S3_FORCE_PATH_STYLE=true`。配置与权限建议见 [MinIO / S3 配置](/deployment/minio-s3)。

存储后端也可以在管理面板中配置。切换只影响新上传文件，不会自动迁移旧对象。

## 邮件

设置 `SMTP_ENABLED=false` 可以在不配置邮件的情况下完成初始化。启用后需要完整填写主机、端口、TLS、凭据和发件邮箱，并在管理面板发送测试邮件。

生产环境不能使用仅写日志的开发邮件方式。详细说明见 [邮件设置](/guide/admin/mail-settings)。

## OAuth 与 Passkey

OAuth Provider 和 Passkey 站点身份优先通过管理员界面配置和测试。环境变量中的 OIDC 配置可以作为启动来源。

Passkey 在正式域名下需要 HTTPS，并要求 RP ID 与 Origin 和真实访问地址一致。

## 外链策略

外链公开地址、邮箱提供方式、访客哈希和限流可以通过环境变量设置。运行后的匿名访问、邮箱域名、下载、预览、有效期和审计策略在管理员界面中管理。

调整限流前先观察真实访问量。过低会影响多人共享，过高会削弱验证码和下载保护。

## Docker Compose 变量

Compose 的 `.env` 首先用于变量插值，只有在 `compose.yaml` 的 `environment` 或 `env_file` 中引用后才会传入容器。修改后用以下命令检查：

```bash
docker compose config
docker compose up -d
```

避免把包含密钥的 `docker compose config` 完整输出复制到公开问题中。

## 生产启动校验

ICEDR 会拒绝：

- 缺失或长度不足的认证安全密钥。
- `replace-me`、`example.com`、尖括号等常见占位值。
- 公开地址指向 `localhost` 或回环地址。
- 无效端口、URL 或邮箱。
- 生产环境启用开发数据、内存存储或开发邮件日志。

启动失败时，日志会列出变量名。只公开变量名和脱敏后的结构，不要公开密码、Secret、验证码或完整连接串。

完整列表见 [环境变量速查表](/reference/environment-variables)。
