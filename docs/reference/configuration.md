# 配置说明

ICEDR 可以通过环境变量和管理员设置面板配置。首次部署可以先按默认值完成初始化；生产部署可用本页核对运行变量。

## 配置优先级

一般规则：

1. 环境变量用于启动前必须确定的配置，例如监听端口、生产模式、数据库连接。
2. 初始化向导用于首次配置管理员账号、数据库、认证方式、SMTP、对象存储和站点信息。
3. 管理员设置面板用于运行后调整站点、认证、外链策略、文件存储和邮件。

如果没有设置 PostgreSQL，ICEDR 使用 SQLite。如果没有启用对象存储，ICEDR 使用本地文件存储。

## 基础服务

| 变量 | 说明 | 默认值 | 何时需要 |
| --- | --- | --- | --- |
| `NODE_ENV` | Node.js 运行环境 | `development` | 生产环境设为 `production` |
| `APP_ENV` | ICEDR 应用环境 | 跟随 `NODE_ENV` | 生产环境设为 `production` |
| `API_HOST` | 服务监听地址 | `0.0.0.0` 或本地开发值 | 容器内通常保持 `0.0.0.0` |
| `API_PORT` | 服务监听端口 | `13000` 或 `13001` | 改端口时设置 |
| `PORT` | 兼容平台端口变量 | 空 | PaaS 平台只提供 `PORT` 时使用 |
| `API_CORS_ORIGIN` | 允许访问 API 的浏览器来源 | 空 | 前端和 API 不同源时必须设置 |
| `API_PUBLIC_BASE_URL` | API 对外访问地址 | 空 | 域名、OAuth 回调、外部链接需要 |
| `VITE_API_BASE_URL` | 浏览器 API 地址 | `/api` | 只有分离前后端构建时需要 |
| `DEFAULT_WORKSPACE_ACTOR` | 默认工作区主体显示名 | `Workspace User` | 想改审计显示名称时设置 |

Docker 镜像默认把前端和 API 放在同源下，浏览器访问 `/api` 即可，不需要把 `VITE_API_BASE_URL` 指向本机地址。

## 数据目录

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `ICEDR_DATA_DIR` | 二进制或后端运行数据目录 | 源码运行时为项目 `data`，二进制运行时为可执行文件旁的 `data` |
| `SQLITE_DATABASE_PATH` | SQLite 数据库文件路径 | `data/icedr.sqlite` |
| `LOCAL_STORAGE_ROOT` | 本地文件存储目录 | `data/local-files` |

备份时至少保留：

- SQLite 文件
- `local-files` 目录
- `database-source.json`
- 如使用二进制，还可以保留 `assets/public` 和 `native` 目录以减少下次启动写入

## 数据库

不配置数据库变量时，ICEDR 使用 SQLite。SQLite 适合试用、小规模和单机部署。

要使用 PostgreSQL：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_HOST` | PostgreSQL 主机 |
| `DATABASE_PORT` | PostgreSQL 端口，通常为 `5432` |
| `DATABASE_DBNAME` | 数据库名 |
| `DATABASE_USER` | 用户名 |
| `DATABASE_PASSWORD` | 密码 |

Docker run 示例：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e DATABASE_HOST=postgres.example.internal \
  -e DATABASE_PORT=5432 \
  -e DATABASE_DBNAME=icedr \
  -e DATABASE_USER=icedr_app \
  -e DATABASE_PASSWORD=strong-password \
  corecherry/icedr-po:latest
```

二进制示例：

```bash
DATABASE_HOST=postgres.example.internal DATABASE_PORT=5432 DATABASE_DBNAME=icedr DATABASE_USER=icedr_app DATABASE_PASSWORD=strong-password ./icedr_VERSION_linux-x86_64
```

也可以在首次初始化向导中选择 PostgreSQL。系统会保存已验证的数据库来源。

## Redis

Redis 是可选项。需要队列、缓存或后续扩展能力时再配置。

| 变量 | 说明 |
| --- | --- |
| `REDIS_HOST` | Redis 主机 |
| `REDIS_PORT` | Redis 端口，通常为 `6379` |
| `REDIS_DBNAME` | Redis DB 编号 |
| `REDIS_USER` | 用户名，可为空 |
| `REDIS_PASSWORD` | 密码，可为空 |

## 文件存储

默认本地文件存储：

```text
data/local-files
```

使用 S3 / MinIO / 兼容对象存储时：

| 变量 | 说明 | 建议 |
| --- | --- | --- |
| `S3_ENDPOINT` | 对象存储 API 地址 | MinIO 示例：`https://minio.example.com` |
| `S3_PUBLIC_ENDPOINT` | 对外访问地址 | 需要和内部 endpoint 分离时设置 |
| `S3_REGION` | 区域 | MinIO 常用 `us-east-1` |
| `S3_BUCKET` | 桶名 | 例如 `icedr-drive` |
| `S3_ACCESS_KEY_ID` | Access Key | 使用专用账号 |
| `S3_SECRET_ACCESS_KEY` | Secret Key | 使用专用密钥 |
| `S3_FORCE_PATH_STYLE` | 是否使用 path-style 请求 | MinIO 通常为 `true` |
| `STORAGE_QUOTA_BYTES` | 物理存储配额上限 | 可选 |
| `MINIO_METRICS_ENDPOINT` | MinIO 指标接口 | 可选，用于容量状态 |
| `MINIO_METRICS_BEARER_TOKEN` | MinIO 指标令牌 | 可选 |

初始化向导中，只有勾选对象存储后才会显示这些配置项。未启用对象存储时，本地文件存储继续工作。

## 外链与公网地址

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `PUBLIC_SHARE_BASE_URL` | 外链分享基础地址 | `https://drive.example.com/share/s` |
| `API_PUBLIC_BASE_URL` | API 对外地址 | `https://drive.example.com/api` |
| `API_CORS_ORIGIN` | 允许访问来源 | `https://drive.example.com` |
| `SHARE_EMAIL_PROVIDER` | 外链邮件提供方式 | `smtp` |
| `SHARE_VISITOR_HASH_SECRET` | 访客身份哈希密钥 | 长随机字符串 |

使用反向代理时，建议让页面和 API 同域：

```text
https://drive.example.com
https://drive.example.com/api
```

这样浏览器端不需要跨域，配置也更简单。

## 邮件 SMTP

SMTP 可以关闭。关闭时，系统仍可初始化和管理文件；需要邮箱验证、外链身份确认或邮件通知时再启用。

| 变量 | 说明 |
| --- | --- |
| `SMTP_ENABLED` | 是否启用 SMTP，`true` 或 `false` |
| `SMTP_HOST` | SMTP 主机 |
| `SMTP_PORT` | SMTP 端口 |
| `SMTP_SECURE` | 是否使用 TLS |
| `SMTP_USERNAME` | 用户名 |
| `SMTP_PASSWORD` | 密码 |
| `SMTP_FROM_NAME` | 发件人名称 |
| `SMTP_FROM_EMAIL` | 发件人邮箱 |
| `SMTP_REPLY_TO` | 回复邮箱，可为空 |

常见组合：

| 邮件服务类型 | `SMTP_PORT` | `SMTP_SECURE` |
| --- | --- | --- |
| STARTTLS | `587` | `false` |
| TLS | `465` | `true` |

## 登录与 OAuth

本地账号登录默认可用。需要接入统一身份认证时，使用 OIDC：

| 变量 | 说明 |
| --- | --- |
| `ICA_OAUTH_PROVIDER_PROFILE` | 提供方类型，标准 OIDC 使用 `oidc` |
| `ICA_OAUTH_ISSUER_URL` | Issuer 地址 |
| `ICA_OAUTH_CLIENT_ID` | Client ID |
| `ICA_OAUTH_CLIENT_SECRET` | Client Secret |
| `ICA_OAUTH_AUDIENCE` | Audience |
| `ICA_OAUTH_SCOPES` | Scope 列表 |
| `ICA_OAUTH_REDIRECT_URI` | 回调地址 |

普通 OIDC 提供方使用 `oidc`。兼容旧形态的 `icetowne-blog` 只适合对应旧接口，不建议作为通用 OAuth 配置。

## 更新检查

| 变量 | 说明 |
| --- | --- |
| `APP_VERSION` | 当前版本，发布产物通常自动写入 |
| `ICEDR_UPDATE_CHECK_URL` | 自定义更新检查地址 |
| `ICEDR_UPDATE_INCLUDE_PRERELEASES` | 是否在更新检查中包含预发布版本 |

稳定版本默认只把稳定版本视为更新。预发布版本可以识别新的预发布和稳定版本。

## Docker 变量

使用 `docker run` 时，直接用本页列出的原始环境变量传入容器。

示例：

| docker run 参数 | 作用 |
| --- | --- |
| `-p 13000:13000` | 把宿主机 `13000` 映射到容器内 `13000` |
| `-v /opt/icedr/data:/workspace/backend/data` | 把持久化数据保存到宿主机目录 |
| `-e API_PUBLIC_BASE_URL=https://drive.example.com/api` | 设置 API 对外地址 |
| `-e PUBLIC_SHARE_BASE_URL=https://drive.example.com/share/s` | 设置外链对外地址 |
| `-e SMTP_ENABLED=false` | 关闭 SMTP，之后可在管理员设置中配置 |

仓库内的 `deploy/docker-compose.yml` 仍然保留给需要 Compose 的场景。使用该文件时，它会为了避免误读本地 `.env` 而采用 `ICEDR_DOCKER_*` 前缀；常规 Docker 部署优先使用 [Docker 部署](/guide/docker) 中的 `docker run` 命令。

## 生产环境校验

生产模式下，ICEDR 会拒绝常见错误配置：

- 使用 `replace-me`、`example.com`、`password` 这类占位值。
- 公开 URL 指向 `localhost` 或 `127.0.0.1`。
- 端口不是合法 TCP 端口。
- 邮箱格式不正确。
- 生产环境仍启用开发邮件模式。
- 生产环境启用开发数据或内存存储。

启动失败时，日志会列出具体变量名。按日志逐项修正即可。
