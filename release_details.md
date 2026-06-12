# ICEDR v0.0.1-alpha.2

> [!IMPORTANT]
>
> 这是 ICEDR 的第二个预发布版本，适合部署体验、功能验证和早期反馈。预发布阶段仍可能调整接口、配置项和数据结构；升级前请备份数据库、`data` 目录和对象存储配置。

## Highlights / 更新亮点

- Docker 与二进制部署体验更完整，README 提供最小部署命令，VitePress 文档提供完整配置说明。
- 二进制运行时默认在可执行文件所在目录旁创建 `data`，便于复制、备份和迁移。
- 首次初始化中的对象存储配置更清晰，未启用对象存储时不会要求填写 S3 / MinIO 参数。
- 文档站的最新发布信息改为构建时生成，减少页面访问时触发 GitHub API 限流的风险。
- Docker 镜像仓库名统一为 `corecherry/icedr-po` 和 `ghcr.io/cloudwhile/icedr-po`。

## Added / 新增

- 新增 Docker 部署文档，覆盖已发布镜像、`docker run -d`、端口映射、持久化目录、环境变量和升级方式。
- 新增二进制部署文档，覆盖平台选择、启动方式、长期运行、数据目录和校验方式。
- 新增发布与校验说明，展示 Release 文件、Docker 标签、MD5 / SHA256 和 `release-manifest.json` 的用途。
- 新增应用和文档站 favicon，统一浏览器标签页图标。
- README 新增最小 Docker 部署和最小二进制部署示例。

## Changed / 变更

- README 保留快速部署入口，详细部署矩阵统一放入 VitePress 文档，减少重复说明。
- 长期部署文档中的固定版本号示例改为 `VERSION` 占位，避免每次发布重复修改同一块内容。
- 首次初始化流程中，对象存储配置改为启用后展示；未启用时继续使用本地文件存储。
- Docker Compose 默认镜像指向 `corecherry/icedr-po`。
- 文档站最新发布组件展示 Docker 标签和发布类型，并优先读取构建生成的发布数据。

## Fixed / 修复

- 修复 Docker 构建时未复制 `patches/entities@7.0.1.patch`，导致 `pnpm install --frozen-lockfile` 失败的问题。
- 修复二进制包在 Windows 等环境下错误使用用户目录创建 `data` 的问题。
- 修复二进制包加载 SQLite 原生扩展时缺少模块根目录的问题。
- 修复文档站在 Node.js 24 构建环境下的依赖兼容问题。
- 修复 GHCR 镜像命名空间，避免发布到不存在的 owner。

## Security / 安全

- 对象存储密钥相关配置仅在启用对象存储后展示，降低初始化阶段误填或误暴露敏感配置的概率。
- Release 继续提供 MD5、SHA256 和 manifest，便于校验下载文件完整性和来源。

## Breaking Changes / 破坏性变更

None / 暂无

## Upgrade Notes / 升级说明

- 从 `v0.0.1-alpha.1` 升级前，请备份 SQLite 数据库、`data/local-files` 和对象存储配置。
- Docker 部署需要重新拉取 `corecherry/icedr-po:0.0.1-alpha.2` 或 `ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.2`。
- Docker 部署应继续挂载原来的宿主机数据目录或 volume。
- 二进制部署建议将新二进制文件放到原目录，继续使用原来的 `data`。
- 如果旧二进制曾在用户目录下创建 `data`，请先确认真实数据位置，再迁移到新的程序目录旁。
- 环境变量无需为本次发布强制修改。

## Known Issues / 已知问题

- 这是预发布版本，接口、配置项和数据结构仍可能在后续版本调整。
- 当前发布流程只生成已支持平台的二进制文件；未出现在 Release assets 中的平台暂未提供官方二进制。
- 预发布版本不会更新 Docker `latest` 标签，部署时需要使用明确版本号。

## Compatibility / 兼容性

- Node.js：24
- 包管理器：pnpm 10.18.1
- Docker 镜像：`corecherry/icedr-po:0.0.1-alpha.2`、`ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.2`
- Docker 平台：linux/amd64、linux/arm64
- 数据库：默认 SQLite，可配置 PostgreSQL
- 文件存储：默认本地文件存储，可配置 S3 / MinIO 兼容对象存储
- 浏览器：现代 Chromium、Firefox、Safari 和 Edge

## Contributors / 贡献者

- Cloudwhile

## Full Changelog / 完整变更

https://github.com/Cloudwhile/icedr/compare/v0.0.1-alpha.1...v0.0.1-alpha.2
