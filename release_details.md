# ICEDR v0.0.1-alpha.3

> [!IMPORTANT]
>
> 这是一个用于部署验证和早期反馈的预发布版本。升级前请备份 `data` 目录、SQLite 数据库、本地文件和对象存储配置。

## Highlights

- 修复 Windows 二进制启动失败问题。内置 SQLite 原生扩展现在会从可执行文件目录下加载，不再被 Node SEA 当作内置模块解析。
- 已验证二进制运行数据默认保存在可执行文件旁边，包括 `data/icedr.sqlite` 和 `data/native/.../better_sqlite3.node`。
- Docker 构建会在安装依赖前复制 pnpm patch 文件，CI 和镜像构建中的 patched dependency 可以正常安装。
- 下载文件继续提供 MD5 和 SHA256 校验信息，便于确认文件完整性。

## Changed

- 二进制打包改为先由 Prisma 生成 SQLite 建表 SQL，再用 `better-sqlite3` 创建内置模板库，避开 Windows 上 `prisma db push` 的 schema-engine 空错误。
- SEA 启动代码会在加载后端 bundle 前注入全局文件系统 `require`，确保原生扩展可以从已释放到磁盘的文件加载。

## Fixed

- 修复二进制加载 `data/native/win32-x64/137/better_sqlite3.node` 时出现 `ERR_UNKNOWN_BUILTIN_MODULE` 的问题。
- 修复打包阶段创建 SQLite 模板库时 Prisma schema-engine 返回空错误的问题。
- 修复 Docker 镜像构建时缺少 `patches/entities@7.0.1.patch`，导致 `pnpm install --frozen-lockfile` 失败的问题。
- 修复二进制启动排查时容易表现为在用户目录创建 `data` 的问题；默认路径现在明确位于可执行文件目录旁。

## Upgrade Notes

- 二进制部署请替换为 `v0.0.1-alpha.3` 对应平台文件，并保留原来的 `data` 目录。
- Docker 部署请在镜像发布后拉取 `corecherry/icedr-po:0.0.1-alpha.3` 或 `ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.3`。
- 预发布版本不会更新 Docker `latest` 标签，请使用明确的 `0.0.1-alpha.3` 标签。
- 本次发布不要求修改环境变量。

## Known Issues

- 这仍然是预发布版本，稳定版前接口、配置字段和数据库结构仍可能调整。
- 只有 Release 页面列出的平台才提供官方二进制文件。

## Compatibility

- Node.js 24
- pnpm 10.18.1
- Docker 镜像：`corecherry/icedr-po:0.0.1-alpha.3`、`ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.3`
- Docker 平台：`linux/amd64`、`linux/arm64`
- 默认数据库：SQLite
- 可选数据库：PostgreSQL
- 文件存储：默认本地文件系统，可选 S3 / MinIO 兼容对象存储
- 已 smoke 测试二进制：Windows x86_64

## Full Changelog

https://github.com/Cloudwhile/icedr/compare/v0.0.1-alpha.2...v0.0.1-alpha.3
