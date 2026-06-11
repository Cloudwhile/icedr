# 快速开始

ICEDR 可以通过 Docker 或二进制文件运行。默认情况下，系统会在本地 `data` 目录下保存持久化数据，并优先使用 SQLite 数据库；当管理员配置 PostgreSQL 后，再迁移到外部数据库。

## 环境要求

- Node.js 24 用于源码构建和本地调试。
- pnpm 10 用于安装依赖。
- Docker 用于容器部署。

## 从源码构建

```bash
pnpm install --frozen-lockfile
pnpm build
```

前端构建产物由后端静态托管，默认 API 前缀为 `/api`。

## 本地验证

```bash
pnpm --filter backend build
pnpm --filter frontend build
```

如需构建二进制发布文件：

```bash
pnpm package:binary
```

生成的文件位于 `dist/binaries`。
