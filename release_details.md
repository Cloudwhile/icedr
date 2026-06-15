# ICEDR v0.0.1-alpha.5

> [!IMPORTANT]
>
> 这是一个用于部署验证和早期反馈的预发布版本。升级前请备份 `data` 目录、SQLite 数据库、本地文件和对象存储配置。

## Highlights

- 二进制运行时生成的前端静态资源从可执行文件旁的 `public` 移到 `data/assets/public`，数据目录结构更集中。
- SQLite 运行时会在启动时补齐旧库缺失的空间范围字段，降低 alpha.4 前后数据库结构不一致导致启动失败的风险。
- 文档发布页只展示 Release 资产和校验入口，不再把发布说明正文塞进页面时间线。

## Added

- SQLite 启动兜底会为 `file_nodes` 和 `upload_sessions` 自动补齐 `space_scope` 列。
- SQLite 启动兜底会确保 `file_nodes_workspace_id_space_scope_idx` 索引存在。
- 二进制部署文档补充 `data/assets/public` 的目录说明和备份建议。

## Changed

- 二进制默认 `FRONTEND_DIST_DIR` 改为 `data/assets/public`；显式设置 `FRONTEND_DIST_DIR` 时仍按用户配置优先。
- 文档站点 Release 数据生成脚本不再生成 Release Notes HTML，只保留 Release 元数据和资产列表。
- VitePress 最新发布组件移除发布说明正文渲染，保留可折叠版本时间线、Docker 标签和资产信息。
- README 中的当前预发布版本和示例镜像标签更新为 `v0.0.1-alpha.5`。

## Fixed

- 修复旧 SQLite 数据库缺少 `space_scope` 字段时，alpha.4 之后的文件模块可能无法正常读取的问题。
- 修复二进制运行后在可执行文件旁生成散落 `public` 目录的问题。
- 修复发布页历史记录过重、正文和资产列表重复承载发布信息的问题。

## Security

- SQLite 运行时补齐空间范围字段后，旧库也能继续使用工作空间与个人空间隔离逻辑。
- 二进制前端资源进入 `data/assets/public` 后，运行时生成文件统一落在数据目录内，便于备份、审计和迁移。

## Breaking Changes

暂无。

## Upgrade Notes

- 升级前请备份 `data` 目录、SQLite 数据库、本地文件目录和对象存储配置。
- 二进制部署请替换为 `v0.0.1-alpha.5` 对应平台文件，并保留原来的 `data` 目录。
- Docker 部署请在镜像发布后拉取 `corecherry/icedr-po:0.0.1-alpha.5` 或 `ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.5`。
- 预发布版本不会更新 Docker `latest` 标签，请使用明确的 `0.0.1-alpha.5` 标签。
- 二进制首次启动会把内嵌前端资源释放到 `data/assets/public`；旧的可执行文件旁 `public` 目录不再作为默认生成位置。
- 本次发布不要求修改环境变量。

## Known Issues

- 这仍然是预发布版本，稳定版前接口、配置字段和数据库结构仍可能调整。
- 只有 Release 页面列出的平台才提供官方二进制文件。
- 发布页的完整历史记录依赖 GitHub Release 数据生成结果；无法读取 Release API 时会显示暂无发布记录。
- 这次发布不会自动清理历史二进制版本生成在可执行文件旁的旧 `public` 目录。

## Compatibility

- Node.js 24
- pnpm 10.18.1
- Docker 镜像：`corecherry/icedr-po:0.0.1-alpha.5`、`ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.5`
- Docker 平台：`linux/amd64`、`linux/arm64`
- 默认数据库：SQLite
- 可选数据库：PostgreSQL
- 文件存储：默认本地文件系统，可选 S3 / MinIO 兼容对象存储
- 浏览器：当前版本 Chrome、Edge、Firefox、Safari

## Full Changelog

https://github.com/Cloudwhile/icedr/compare/v0.0.1-alpha.4...v0.0.1-alpha.5
