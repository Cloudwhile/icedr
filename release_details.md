# ICEDR v0.0.1-alpha.4

> [!IMPORTANT]
>
> 这是一个用于部署验证和早期反馈的预发布版本。升级前请备份 `data` 目录、SQLite 数据库、本地文件和对象存储配置。

## Highlights / 更新亮点

- 工作空间与个人空间的文件内容、根目录显示、对象存储路径和容量统计进一步分离，避免不同空间的数据和配额语义混在一起。
- 网盘复制、剪切、粘贴交互改为先复制或剪切，再由目标目录执行粘贴；无可粘贴内容时不显示粘贴操作。
- 工作区空白区域右键范围扩大，列表或网格下方的空白区域也能打开创建、刷新、视图和粘贴菜单。
- VitePress 发布页改为自下而上的可折叠时间线，版本号旁显示发布状态徽标，Release Notes 会渲染为正文而不是原始 Markdown。
- Windows 本地开发启动脚本不再依赖 `concurrently` 的可执行链接，避免 `spawn EINVAL` 和命令找不到的问题。

## Added / 新增

- 文件节点新增空间范围字段，用于区分工作空间文件和个人空间文件。
- 新增数据库迁移，为既有文件节点补齐默认空间范围。
- 存储用量接口支持按空间范围读取容量、文件数量和配额信息。
- 右键空白菜单支持在可粘贴状态下显示粘贴入口。
- 发布数据生成脚本支持读取多条 GitHub Release，并为文档站点生成可渲染的发布说明 HTML。

## Changed / 变更

- 工作空间根目录只显示“工作空间”，个人空间根目录显示“我的文件”，避免默认工作空间被误描述为个人空间。
- 复制和移动操作不再要求先选择目标目录，目标位置由当前目录的粘贴动作决定。
- 粘贴菜单项不再常驻禁用，也不再作为空白右键菜单的第一项或单独分栏。
- 文件模块布局会填满工作区内容区域，使空白处点击和右键行为更一致。
- 根目录开发命令改为由 `scripts/dev.cjs` 同时启动前端和后端。

## Fixed / 修复

- 修复工作空间与个人空间内容混合显示和容量统计口径不清的问题。
- 修复对象存储路径缺少空间范围导致不同空间文件对象边界不清的问题。
- 修复空白区域右键范围过小，工作区部分空白处无法打开菜单的问题。
- 修复没有复制或剪切内容时仍显示禁用的粘贴入口的问题。
- 修复发布页截断 Release Notes、并把 Markdown 源码直接显示给用户的问题。
- 修复 Windows 下 `pnpm run dev` 可能出现 `concurrently` 找不到或 `spawn EINVAL` 的问题。

## Security / 安全

- 文件对象键加入空间范围隔离，降低工作空间和个人空间文件在存储层混淆的风险。
- 粘贴操作会校验来源空间、工作空间和目标目录，避免跨空间粘贴或把目录移动到自身子目录。

## Breaking Changes / 破坏性变更

暂无。

## Upgrade Notes / 升级说明

- 升级前请备份 `data` 目录、SQLite 数据库、本地文件目录和对象存储配置。
- 二进制部署请替换为 `v0.0.1-alpha.4` 对应平台文件，并保留原来的 `data` 目录。
- Docker 部署请在镜像发布后拉取 `corecherry/icedr-po:0.0.1-alpha.4` 或 `ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.4`。
- 预发布版本不会更新 Docker `latest` 标签，请使用明确的 `0.0.1-alpha.4` 标签。
- 本次发布包含数据库迁移，服务启动时需要确保迁移流程可以正常执行。
- 本次发布不要求修改环境变量。

## Known Issues / 已知问题

- 这仍然是预发布版本，稳定版前接口、配置字段和数据库结构仍可能调整。
- 只有 Release 页面列出的平台才提供官方二进制文件。
- 发布页的完整历史记录依赖 GitHub Release 数据生成结果；无法读取 Release API 时会显示暂无发布记录。

## Compatibility / 兼容性

- Node.js 24
- pnpm 10.18.1
- Docker 镜像：`corecherry/icedr-po:0.0.1-alpha.4`、`ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.4`
- Docker 平台：`linux/amd64`、`linux/arm64`
- 默认数据库：SQLite
- 可选数据库：PostgreSQL
- 文件存储：默认本地文件系统，可选 S3 / MinIO 兼容对象存储
- 浏览器：当前版本 Chrome、Edge、Firefox、Safari

## Full Changelog / 完整变更

https://github.com/Cloudwhile/icedr/compare/v0.0.1-alpha.3...v0.0.1-alpha.4
