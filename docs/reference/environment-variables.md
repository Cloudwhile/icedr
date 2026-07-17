# 环境变量速查表

本页用于快速查找变量。部署示例和选择逻辑见 [配置说明](/reference/configuration)。除非特别说明，留空表示不启用对应外部服务。

## 运行与安全

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 生产设为 `production` |
| `APP_ENV` | 跟随 `NODE_ENV` | ICEDR 应用环境 |
| `API_HOST` | `127.0.0.1` | 服务监听地址；容器内常用 `0.0.0.0` |
| `API_PORT` | `13001` | 服务监听端口；发布容器通常使用 `13000` |
| `PORT` | 空 | 平台仅提供统一端口变量时的兼容项 |
| `AUTH_SECURITY_SECRET` | 开发默认值 | 生产必填，至少 32 字符的随机值 |
| `DEFAULT_WORKSPACE_ACTOR` | `Workspace User` | 默认工作区主体显示名 |
| `ALLOW_DEV_MEMORY_STORE` | `false` | 仅开发；生产不能开启 |
| `SEED_DEMO_DATA` | `false` | 仅开发；生产不能开启 |

## 公开地址

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `API_CORS_ORIGIN` | `https://drive.your-domain.tld` | 允许的浏览器来源 |
| `API_PUBLIC_BASE_URL` | `https://drive.your-domain.tld/api` | ICEDR 服务的外部基础地址 |
| `VITE_API_BASE_URL` | `/api` | 构建网页时的同源服务地址，常规发布镜像无需修改 |
| `PUBLIC_SHARE_BASE_URL` | `https://drive.your-domain.tld/share/s` | 生成外链时使用的基础地址 |

这些地址供 ICEDR 网页、分享和认证流程使用，应与浏览器实际访问的 HTTPS 域名一致。

## 数据目录

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ICEDR_DATA_DIR` | 运行方式决定 | 数据根目录 |
| `SQLITE_DATABASE_PATH` | `data/icedr.sqlite` | SQLite 文件位置 |
| `LOCAL_STORAGE_ROOT` | `data/local-files` | 本地文件存储目录 |

## PostgreSQL

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_HOST` | 空 | 数据库主机 |
| `DATABASE_PORT` | `5432` | 数据库端口 |
| `DATABASE_DBNAME` | 空 | 数据库名 |
| `DATABASE_USER` | 空 | 专用用户 |
| `DATABASE_PASSWORD` | 空 | 用户密码 |

五项完整时视为 PostgreSQL 配置。生产环境使用私网、最小权限和独立备份。

## Redis

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REDIS_HOST` | 空 | Redis 主机 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_DBNAME` | 空 | DB 编号；配置 Redis 时必填 |
| `REDIS_USER` | 空 | ACL 用户，可选 |
| `REDIS_PASSWORD` | 空 | 密码，可选 |

Redis 当前属于可选依赖。

## S3 / MinIO

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `S3_ENDPOINT` | 空 | 服务端访问对象存储的地址 |
| `S3_PUBLIC_ENDPOINT` | 空 | 浏览器可访问的对象地址，可选 |
| `S3_REGION` | `us-east-1` | 区域 |
| `S3_BUCKET` | `icedr-drive` | Bucket 名称 |
| `S3_ACCESS_KEY_ID` | 空 | 专用 Access Key |
| `S3_SECRET_ACCESS_KEY` | 空 | 专用 Secret Key |
| `S3_FORCE_PATH_STYLE` | `true` | MinIO 通常为 `true` |
| `STORAGE_QUOTA_BYTES` | 空 | 可选物理存储上限，字节 |
| `MINIO_METRICS_ENDPOINT` | 空 | 容量指标地址，可选 |
| `MINIO_METRICS_BEARER_TOKEN` | 空 | 只读指标令牌，可选 |

## SMTP

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SMTP_ENABLED` | 根据主机判断 | 是否启用邮件投递 |
| `SMTP_HOST` | 空 | SMTP 主机 |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_SECURE` | `false` | 是否使用隐式 TLS |
| `SMTP_USERNAME` | 空 | 用户名 |
| `SMTP_PASSWORD` | 空 | 密码或应用专用密码 |
| `SMTP_FROM_NAME` | `ICEDR` | 发件人名称 |
| `SMTP_FROM_EMAIL` | 空 | 发件邮箱 |
| `SMTP_REPLY_TO` | 空 | 回复邮箱，可选 |
| `SHARE_EMAIL_PROVIDER` | 生产为空 | 外链邮件提供方式；生产通常为 `smtp` |

## OAuth / OIDC 启动来源

| 变量 | 说明 |
| --- | --- |
| `ICA_OAUTH_PROVIDER_PROFILE` | 标准提供方使用 `oidc`；兼容模式只用于对应旧提供方 |
| `ICA_OAUTH_ISSUER_URL` | Issuer 地址 |
| `ICA_OAUTH_CLIENT_ID` | Client ID |
| `ICA_OAUTH_CLIENT_SECRET` | Client Secret |
| `ICA_OAUTH_AUDIENCE` | Audience，默认 `icedr-api` |
| `ICA_OAUTH_SCOPES` | Scope 列表，常用 `openid email profile` |
| `ICA_OAUTH_REDIRECT_URI` | 回调地址；优先从管理界面复制 |

运行后推荐在 OAuth 配置管理页面创建、测试和激活 Provider。

## 外链访问与限流

除 `SHARE_RATE_LIMIT_PROFILE` 外，限流覆盖项留空时会使用所选 profile 的内置规则；仅在需要覆盖单项规则时填写。

直接运行应用时使用下表变量名。使用仓库内 `deploy/docker-compose.yml` 时，宿主机 `.env` 需使用 `ICEDR_DOCKER_` 前缀，例如 `ICEDR_DOCKER_SHARE_RATE_LIMIT_PROFILE`；Compose 会将其映射为容器内变量。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SHARE_VISITOR_HASH_SECRET` | 开发时随机生成 | 生产必填，至少 32 字符且不得与认证密钥相同 |
| `SHARE_RATE_LIMIT_PROFILE` | `default` | `default`、`strict` 或 `relaxed` |
| `SHARE_RATE_LIMIT_WINDOW_SECONDS` | 空 | 覆盖全部规则的统计窗口 |
| `SHARE_RATE_LIMIT_VIEW_MAX` | 空 | 覆盖窗口内查看上限 |
| `SHARE_RATE_LIMIT_VIEW_WINDOW_SECONDS` | 空 | 覆盖查看统计窗口 |
| `SHARE_RATE_LIMIT_EMAIL_CODE_MAX` | 空 | 覆盖验证码发送上限 |
| `SHARE_RATE_LIMIT_EMAIL_CODE_WINDOW_SECONDS` | 空 | 覆盖验证码发送窗口 |
| `SHARE_RATE_LIMIT_EMAIL_VERIFY_MAX` | 空 | 覆盖验证失败上限 |
| `SHARE_RATE_LIMIT_EMAIL_VERIFY_WINDOW_SECONDS` | 空 | 覆盖验证失败统计窗口 |
| `SHARE_RATE_LIMIT_EMAIL_VERIFY_LOCK_SECONDS` | 空 | 覆盖达到上限后的锁定时间 |
| `SHARE_RATE_LIMIT_DOWNLOAD_INTENT_MAX` | 空 | 覆盖下载准备上限 |
| `SHARE_RATE_LIMIT_DOWNLOAD_INTENT_WINDOW_SECONDS` | 空 | 覆盖下载准备统计窗口 |
| `SHARE_RATE_LIMIT_DOWNLOAD_MAX` | 空 | 覆盖正式下载上限 |
| `SHARE_RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS` | 空 | 覆盖正式下载统计窗口 |

## 更新检查

| 变量 | 说明 |
| --- | --- |
| `APP_VERSION` | 当前应用版本，发布产物通常自动写入 |
| `ICEDR_UPDATE_CHECK_URL` | 自定义更新检查来源 |
| `ICEDR_UPDATE_INCLUDE_PRERELEASES` | 稳定版本是否也检查预发布版本 |

当前 Alpha 环境应固定发布标签，并人工阅读 [发布与校验](/reference/releases)。
