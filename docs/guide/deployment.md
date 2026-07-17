# 部署方式对比

ICEDR 提供 Docker 镜像和平台二进制。两种产物都包含网页与服务端，不需要把前端、文件服务和管理面板拆开部署。

::: warning 当前发布状态
当前最新版本是 `v0.0.1-alpha.5`，属于预发布版本。生产评估应固定版本、准备维护窗口，并在升级前验证备份可恢复。
:::

## 选择建议

| 维度 | Docker | Docker Compose | 二进制 |
| --- | --- | --- | --- |
| 适合场景 | 单容器、NAS、VPS | 配置项较多、需要声明式管理 | 禁止容器或希望直接运行文件 |
| 运行依赖 | Docker Engine | Docker Engine 与 Compose | 对应平台操作系统 |
| 数据持久化 | 绑定目录或 volume | 绑定目录或 volume | 可执行文件旁的 `data` 或指定目录 |
| 升级方式 | 替换镜像标签并重建容器 | 修改版本后 `pull`、`up -d` | 替换二进制并保留数据目录 |
| 回滚准备 | 旧镜像加升级前备份 | 旧 Compose 配置加升级前备份 | 旧二进制加升级前备份 |
| 推荐程度 | 简单部署首选 | 正式自托管首选 | 无容器环境使用 |

## 推荐路径

### 单机快速开始

使用 [Docker 部署](/guide/docker)。它最容易确认端口、数据目录和当前版本。

### 长期自托管

使用 [Docker Compose 部署](/deployment/docker-compose)，把 `compose.yaml`、`.env` 和数据目录纳入受控备份。公网访问再接入 [反向代理](/deployment/reverse-proxy) 与 [HTTPS](/deployment/https)。

### 不允许容器

使用 [二进制部署](/guide/binary)，并交给 systemd、Windows 服务或其他进程管理器守护。

## 默认与可选依赖

ICEDR 默认可以只运行一个应用实例：

- 数据库使用 SQLite。
- 文件使用本地存储。
- SMTP 可以关闭。
- Redis 为可选配置。

需要更成熟的运维能力时，再按需接入：

- [PostgreSQL](/deployment/postgresql)。
- [MinIO / S3](/deployment/minio-s3)。
- SMTP 邮件服务。
- OAuth / OIDC 身份提供方。

这些外部服务不包含在 ICEDR 应用镜像内，应分别配置权限、监控和备份。

## 上线共同要求

无论选择哪种方式，都应完成：

1. 持久化 `data` 目录或配置外部数据库与对象存储。
2. 分别设置长期稳定的 `AUTH_SECURITY_SECRET` 和 `SHARE_VISITOR_HASH_SECRET`。
3. 固定发布版本，不在重要数据环境盲目跟随浮动标签。
4. 使用 HTTPS 域名并让页面与服务保持同源。
5. 完成上传、下载、分享、审计和重启验证。
6. 完成数据库与文件对象同一恢复点的备份演练。

## 不建议的方式

- 不要把容器可写层当作持久化存储。
- 不要让多个 ICEDR 实例同时写入同一个 SQLite 文件。
- 不要直接公开数据库、MinIO 管理控制台或应用上游端口。
