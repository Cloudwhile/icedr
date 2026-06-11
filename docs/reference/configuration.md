# 配置项参考

ICEDR 支持通过环境变量和管理员设置面板配置运行参数。没有配置外部数据库时，系统默认使用本地 SQLite。

## 基础服务

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `API_HOST` | 后端监听地址 | `0.0.0.0` |
| `API_PORT` | 后端监听端口 | `13000` |
| `API_CORS_ORIGIN` | 允许跨域访问的来源 | 空 |
| `API_PUBLIC_BASE_URL` | 后端公开访问地址 | 空 |
| `PUBLIC_SHARE_BASE_URL` | 外链公开访问地址 | 空 |

## 数据库

| 变量 | 说明 |
| --- | --- |
| `DATABASE_HOST` | PostgreSQL 主机 |
| `DATABASE_PORT` | PostgreSQL 端口 |
| `DATABASE_DBNAME` | PostgreSQL 数据库名 |
| `DATABASE_USER` | PostgreSQL 用户名 |
| `DATABASE_PASSWORD` | PostgreSQL 密码 |
| `SQLITE_DATABASE_PATH` | SQLite 文件路径 |

未提供 PostgreSQL 配置时，ICEDR 会使用 SQLite。配置 PostgreSQL 后，系统可以通过后台迁移流程切换数据源。

## 文件存储

| 变量 | 说明 |
| --- | --- |
| `LOCAL_STORAGE_ROOT` | 本地文件存储目录 |
| `S3_ENDPOINT` | S3 / MinIO 接入地址 |
| `S3_PUBLIC_ENDPOINT` | 对外访问地址 |
| `S3_REGION` | 区域 |
| `S3_BUCKET` | 存储桶 |
| `S3_ACCESS_KEY_ID` | Access Key |
| `S3_SECRET_ACCESS_KEY` | Secret Key |
| `S3_FORCE_PATH_STYLE` | 是否使用 path-style 请求 |
| `MINIO_METRICS_ENDPOINT` | MinIO 指标接口 |
| `MINIO_METRICS_BEARER_TOKEN` | MinIO 指标访问令牌 |

## 邮件

| 变量 | 说明 |
| --- | --- |
| `SMTP_ENABLED` | 是否启用 SMTP |
| `SMTP_HOST` | SMTP 主机 |
| `SMTP_PORT` | SMTP 端口 |
| `SMTP_SECURE` | 是否使用 TLS |
| `SMTP_USERNAME` | SMTP 用户名 |
| `SMTP_PASSWORD` | SMTP 密码 |
| `SMTP_FROM_NAME` | 发件人名称 |
| `SMTP_FROM_EMAIL` | 发件人邮箱 |
| `SMTP_REPLY_TO` | 回复邮箱 |
