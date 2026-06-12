# 部署方式

ICEDR 发布时提供统一 Docker 镜像和独立二进制文件。Docker 部署只打包本项目自身服务，不额外编排 PostgreSQL、Redis 或对象存储服务。

## Docker Compose

```bash
pnpm docker:build
pnpm docker:up
```

默认监听端口为 `13000`，访问入口为：

```text
http://localhost:13000
```

Compose 文件会将容器内 `/workspace/backend/data` 挂载为持久化卷，默认 SQLite 数据库、本地文件和运行时数据都会保存在该目录下。

## Docker Hub 镜像

Docker Hub 镜像位置为 `corecherry/icedr-po`：

```bash
docker pull corecherry/icedr-po:<tag>
```

## GitHub Container Registry 镜像

GitHub Container Registry 镜像位置为 `ghcr.io/corecherry/icedr-po`：

```bash
docker pull ghcr.io/corecherry/icedr-po:<tag>
```

如果使用 `deploy/docker-compose.yml`，可以通过环境变量指定镜像：

```bash
ICEDR_IMAGE=corecherry/icedr-po ICEDR_TAG=<tag> docker compose -f deploy/docker-compose.yml up -d
```

也可以直接使用 GitHub Container Registry 镜像：

```bash
ICEDR_IMAGE=ghcr.io/corecherry/icedr-po ICEDR_TAG=<tag> docker compose -f deploy/docker-compose.yml up -d
```

## 二进制文件

发布页会附带平台二进制文件，命名格式为：

```text
icedr_VERSION_PLATFORM
```

二进制运行时会优先使用当前工作目录下的 `data` 目录保存持久化数据。
