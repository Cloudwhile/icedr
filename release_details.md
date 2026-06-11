# ICEDR vX.Y.Z

> [!IMPORTANT]
>
> 带有 `alpha`、`beta`、`rc` 等预发布标记的版本会作为 GitHub prerelease 发布，不建议用于生产环境。

本次发布聚焦 ICEDR 的自托管部署、工作区文件管理、外链策略、审计记录、默认 SQLite 数据源、Docker 镜像和二进制发布体验。发布包会附带校验文件，便于确认下载文件完整性和来源。

## Versioning

ICEDR 使用以 `v` 开头的 Git tag 触发发布流程。

稳定版本示例：

```text
v1.2.0
```

预发布版本示例：

```text
v1.2.0-alpha.1
v1.2.0-beta.1
v1.2.0-rc.1
```

发布规则：

- tag 包含 `-` 时，GitHub Release 会标记为 prerelease。
- 稳定版本会更新 Docker 镜像的 `latest` 标签。
- 预发布版本不会更新 Docker 镜像的 `latest` 标签。
- 手动触发 Docker workflow 时默认发布 `edge` 标签，不会更新 `latest`。

## Highlights

- 统一 ICEDR 品牌命名，发布文件不再使用 `ICEDR-API`。
- 新增 VitePress 文档站，并通过 GitHub Pages workflow 部署。
- 新增统一 Docker 镜像，镜像仓库名为 `icedr-po`。
- 新增独立 Docker workflow，Docker Hub 发布不再堆叠在 GitHub Release workflow 中。
- 新增跨平台二进制打包流程，产物命名为 `icedr_VERSION_PLATFORM`。
- 新增 MD5、SHA256 和 manifest 文件，用于发布产物完整性检查。
- 默认优先使用本地 SQLite 保存持久化数据，配置 PostgreSQL 后再迁移数据源。

## Added

- VitePress 文档站，源码位于 `docs`。
- GitHub Pages 部署 workflow，构建产物来自 `docs/.vitepress/dist`。
- Docker Hub 发布 workflow，支持 `linux/amd64` 和 `linux/arm64`。
- 二进制元数据配置，支持自定义图标、描述、产品名和版权信息。
- 发布说明生成流程，会读取根目录 `release_details.md` 并拼接 checksum 信息。
- 审计分页、更多审计事件分类和外链访问身份记录。

## Changed

- Docker 部署改为单个 ICEDR 服务镜像，前端静态文件由后端托管。
- Docker Compose 仅打包本项目服务，不额外编排 PostgreSQL、Redis、MinIO 或 nginx。
- Docker 持久化卷挂载到 `/workspace/backend/data`，覆盖 SQLite、本地文件和运行时数据。
- 系统设置拆分为更清晰的子项，外链策略页仅保留外链访问相关配置。
- README 补充发布版本规则、Docker tag 规则、文档站入口和校验文件说明。

## Fixed

- 修复手动触发 Docker workflow 时可能误更新 `latest` 的风险。
- 修复登录状态下仍可访问登录、注册、找回密码和重置密码页面的问题。
- 修复 Drive 主页面和内部导航缺少稳定路径，刷新后可能回到旧页面的问题。
- 修复预览文件误触发下载审计记录的问题。
- 修复外链页已登录身份认证逻辑和展示主体不一致的问题。

## Security

- GitHub Actions 仅通过 Secrets 读取 Docker Hub 凭据，不在日志中输出密钥值。
- `.dockerignore` 排除环境文件、私有目录、数据目录和构建产物。
- `.env`、`data`、`private-docs` 等本地敏感路径不应进入发布产物或提交。
- 下载文件前统一由后端创建短期访问意图并记录必要审计信息。
- 发布包包含 `MD5SUMS.txt`、`SHA256SUMS.txt` 和 `release-manifest.json`。

## Artifacts

GitHub Release 会包含：

- `icedr_VERSION_windows-x86_64`
- `icedr_VERSION_windows-arm64`
- `icedr_VERSION_linux-x86_64`
- `icedr_VERSION_linux-arm64`
- `icedr_VERSION_macos-x86_64`
- `icedr_VERSION_macos-arm64`
- `MD5SUMS.txt`
- `SHA256SUMS.txt`
- `release-manifest.json`

不支持的平台不会生成发布文件。

## Upgrade Notes

1. 升级前备份数据库和 `data` 目录。
2. Docker 部署请确认持久化卷挂载到 `/workspace/backend/data`。
3. 如果从旧的拆分 Docker 服务迁移，请改用统一 ICEDR 镜像。
4. 如果使用 Docker Hub 镜像，请使用 `<namespace>/icedr-po:<tag>`。
5. 如果使用对象存储，请确认 S3 / MinIO endpoint、bucket、access key 和 secret key 配置正确。
6. 如果使用预发布版本，请避免直接用于生产环境。

## Verification

推荐发布后执行：

```bash
pnpm --filter backend build
pnpm --filter frontend build
pnpm docs:build
docker compose -f deploy/docker-compose.yml config
```

下载二进制文件后，可以使用发布页附带的 checksum 文件验证完整性。

## Full Changelog

See commit history for details.
