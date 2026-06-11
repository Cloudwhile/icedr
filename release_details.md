# ICEDR v0.0.1-alpha.1

> [!IMPORTANT]
>
> 这是 ICEDR 的首次预发布版本。`v0.0.1-alpha.1` 适合测试、体验和早期反馈，不建议直接用于生产环境。

ICEDR v0.0.1-alpha.1 是项目的首次发布，提供自托管网盘、工作区文件管理、外链访问、审计记录、默认 SQLite 持久化、Docker 镜像、文档站和二进制发布能力。发布包会附带校验文件，便于确认下载文件完整性和来源。

## Versioning

本次发布 tag：

```text
v0.0.1-alpha.1
```

版本识别规则：

- `v0.0.1-alpha.1` 会被主程序识别为版本 `0.0.1-alpha.1`。
- 系统状态和管理端显示会保留标准 tag 形式 `v0.0.1-alpha.1`。
- 带有 `alpha`、`beta`、`rc` 等标记的版本会作为 GitHub prerelease 发布。
- 稳定版本会更新 `corecherry/icedr-po:latest`。
- 预发布版本不会更新 `corecherry/icedr-po:latest`。
- 手动触发 Docker workflow 时默认发布 `edge` 标签，不会更新 `latest`。

## Included

- 自托管 ICEDR 服务，前端静态文件由后端统一托管。
- 工作区文件管理，包括上传、下载、预览、回收站、收藏和历史版本。
- 外链分享能力，包括匿名访问、邮箱验证、登录用户识别、下载策略和访问审计。
- 管理员面板，包括系统状态、系统设置、存储策略、外链策略和审计日志。
- 默认本地 SQLite 数据源，持久化数据保存在服务数据目录下。
- 本地文件存储和 S3 / MinIO 对象存储配置。
- Docker 镜像发布，镜像位置为 `corecherry/icedr-po`。
- VitePress 文档站，并通过 GitHub Pages workflow 部署。
- 二进制打包流程，产物命名为 `icedr_VERSION_PLATFORM`。
- 发布校验文件，包括 `MD5SUMS.txt`、`SHA256SUMS.txt` 和 `release-manifest.json`。

## Update Check

- 主程序按 semver 规则比较版本，支持 `alpha`、`beta`、`rc` 等预发布版本。
- 当前版本为预发布版本时，更新检查会同时识别更高的预发布版本和稳定版本。
- 当前版本为稳定版本时，默认只把稳定版本作为可用更新。
- 默认更新源为 ICEDR GitHub Releases，也可以通过 `ICEDR_UPDATE_CHECK_URL` 指向兼容的 JSON 发布源。

## Generated Release Files

具体发布文件、下载 URL、文件大小和校验值会根据实际产物自动追加到 GitHub Release 说明中。不支持的平台不会生成发布文件。

## Integrity

下载发布文件后，可以使用 GitHub Release 附带的 checksum 文件验证完整性：

```bash
md5sum -c MD5SUMS.txt
sha256sum -c SHA256SUMS.txt
```

Windows 用户可以使用 `Get-FileHash` 计算文件摘要，并与 `MD5SUMS.txt` 或 `SHA256SUMS.txt` 中的值比对。

## Docker

Docker Hub 镜像发布到：

```text
corecherry/icedr-po:v0.0.1-alpha.1
```

因为本次是预发布版本，不会更新 `latest` 标签。稳定版本发布后才会更新 `latest`。

## First Release Notes

- 这是首次发布，没有来自旧版 ICEDR 的升级差异。
- 如果你使用的是本地开发构建或手动部署数据，升级前仍建议备份数据库和 `data` 目录。
- 预发布阶段接口、配置项和数据结构可能继续调整。
- 如果使用对象存储，请确认 S3 / MinIO endpoint、bucket、access key 和 secret key 配置正确。

## Verification

推荐发布后执行：

```bash
pnpm --filter backend build
pnpm --filter frontend build
pnpm docs:build
docker compose -f deploy/docker-compose.yml config
```

## Full Changelog

这是 ICEDR 的首次发布，没有历史 release changelog。
