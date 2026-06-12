# 部署方式对比

ICEDR 面向自托管发布两类可直接使用的产物：

- Docker 镜像：`corecherry/icedr-po` 或 `ghcr.io/cloudwhile/icedr-po`
- 平台二进制文件：`icedr_VERSION_PLATFORM`

这两种方式均无需从源码构建。源码构建主要用于开发、调试和二次开发。

## 推荐选择

| 场景 | 推荐方式 | 原因 |
| --- | --- | --- |
| 有 Docker 或容器平台 | Docker | 镜像包含运行环境，升级和回滚更清晰 |
| 家用服务器、NAS、单台 VPS | Docker | `docker run` 可以固定端口和本地持久化目录 |
| 不允许使用容器 | 二进制 | 只需要一个可执行文件和数据目录 |
| Windows 桌面测试 | 二进制 | 下载 `.exe` 后即可启动 |
| 需要二次开发 | 源码 | 可以运行测试、修改前后端代码 |

## Docker 的边界

ICEDR 的 Docker 镜像只打包本项目：

- 前端页面
- 后端 API
- Prisma 客户端和运行依赖
- 本地 SQLite 默认路径
- 本地文件存储默认路径

镜像不会内置 PostgreSQL、Redis、MinIO 或 SMTP 服务。这些服务通常已有独立的备份、权限和运维策略，因此不随应用镜像内置。

试用或小规模部署无需准备这些外部服务。默认 SQLite 和本地文件存储已经可以完成初始化。

## 二进制的边界

二进制文件把 ICEDR 后端和已构建的前端一起封装为一个可执行程序。它会在可执行文件所在目录创建 `data`，默认使用：

- `data/icedr.sqlite`
- `data/local-files`

它适合简单服务器和单机部署。仍可通过环境变量接入 PostgreSQL、S3 / MinIO 和 SMTP。

## 推荐 Docker 启动方式

常规部署优先使用 `docker run`，并把容器内 `/workspace/backend/data` 映射到宿主机固定目录：

```bash
mkdir -p /opt/icedr/data

docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:latest
```

仓库内的 `deploy/docker-compose.yml` 仍然保留给开发者和需要 Compose 的场景，但文档主流程以已发布镜像的 `docker run` 为准。

## 初始化向导如何工作

无论 Docker 还是二进制，使用全新的数据目录首次访问时都会进入初始化向导。

初始化向导会先完成能安全启动系统的最小配置：

1. 数据库：默认 SQLite，可切换 PostgreSQL。
2. 管理员账号：创建第一个管理员。
3. 登录方式：本地账号、OIDC、Passkey 可按需启用。
4. 邮件：可关闭，也可填写 SMTP 并测试。
5. 文件存储：默认本地；勾选对象存储后才显示 S3 / MinIO 字段。
6. 品牌信息：站点名称和登录页标识。

这意味着“需要配置才能启用”的功能不会在未启用时打断初始化流程。

## 生产部署检查清单

上线前建议确认：

- 已备份 `data` 目录或 Docker volume。
- 使用明确版本标签，例如 `1.2.0-alpha.1`，避免在生产环境直接跟随 `latest`。
- 如果通过域名访问，已设置 `PUBLIC_SHARE_BASE_URL`、`API_PUBLIC_BASE_URL` 和 `API_CORS_ORIGIN`。
- 如果需要邮箱验证，SMTP 已测试通过。
- 如果使用对象存储，桶权限和访问密钥只授予 ICEDR 所需范围。
- 如果使用 PostgreSQL，数据库有备份和恢复方案。
- 反向代理允许上传文件所需的请求体大小和超时时间。

## 下一步

- 按 [Docker 部署](/guide/docker) 使用已发布镜像。
- 按 [二进制部署](/guide/binary) 使用平台可执行文件。
- 按 [配置说明](/reference/configuration) 补齐生产变量。
