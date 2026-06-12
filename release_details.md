# ICEDR v0.0.1-alpha.2

> [!IMPORTANT]
>
> 这是 ICEDR 的第二个预发布版本，适合部署体验、功能验证和早期反馈。预发布阶段仍可能调整接口、配置项和数据结构；升级前请备份数据库、`data` 目录和对象存储配置。

ICEDR v0.0.1-alpha.2 基于首次预发布继续完善部署体验、发布文档和首次初始化流程。本次发布重点解决二进制运行时数据目录、Docker 镜像命名、GitHub Pages 发布信息读取和对象存储设置引导问题。

## 本次重点

- 完善 Docker 与二进制部署文档，明确已发布镜像、持久化目录、端口映射、环境变量和升级方式。
- 修复二进制包在 Windows 等环境下错误使用用户目录创建 `data` 的问题，默认数据目录改为可执行文件所在目录旁的 `data`。
- 修复二进制包加载 SQLite 原生扩展时缺少模块根目录的问题。
- 保持 Docker Hub 和 GHCR 仓库名一致：`corecherry/icedr-po` 与 `ghcr.io/cloudwhile/icedr-po`。
- 优化首次初始化中的对象存储设置：未启用对象存储时不显示 S3 / MinIO 必填项，启用后再展示对应配置。
- 调整文档站最新发布信息的生成方式，避免页面访问时触发 GitHub API 限流。
- 为应用和文档站接入统一 favicon。
- 修复文档站在 Node.js 24 构建环境下的依赖兼容问题。

## 使用者可见变化

### 部署文档

- 新增 Docker 部署文档，推荐使用 `docker run -d` 直接启动已发布镜像。
- 新增二进制部署文档，说明平台文件选择、启动方式、长期运行、数据目录和校验方式。
- 扩充配置说明，覆盖数据库、Redis、文件存储、外链公开地址、SMTP、OIDC、更新检查和生产环境校验。
- 发布说明页会展示最新 Release 信息、发布文件、日期、Docker 标签和校验方式。

### 首次初始化

- 对象存储改为显式启用后再填写配置项。
- 未配置对象存储时，系统继续使用本地文件存储。
- 初始化流程保留 SQLite 优先体验，适合单机或试用部署；需要 PostgreSQL 时可在数据库步骤配置。

### 二进制运行

- 二进制文件默认在自身所在目录旁创建 `data`。
- SQLite 数据库、本地文件、原生扩展缓存和数据库来源记录都会保存在该目录中。
- 可继续通过 `ICEDR_DATA_DIR` 指定自定义数据目录。

### Docker 发布

- Docker Hub：`corecherry/icedr-po`
- GitHub Container Registry：`ghcr.io/cloudwhile/icedr-po`
- 当前版本为预发布版本，因此不会更新 `latest` 标签。

```bash
docker pull corecherry/icedr-po:0.0.1-alpha.2
docker pull ghcr.io/cloudwhile/icedr-po:0.0.1-alpha.2
```

## 升级提示

- 从 `v0.0.1-alpha.1` 升级前，请备份 SQLite 数据库、`data/local-files` 和对象存储配置。
- 使用 Docker 部署时，继续挂载原来的宿主机数据目录或 volume。
- 使用二进制部署时，建议将新二进制文件放到原目录，继续使用原来的 `data`。
- 如果曾经因为旧二进制在用户目录下创建了 `data`，请先确认真实数据所在位置，再迁移到新的程序目录旁。
- 如果启用了对象存储，请确认 S3 / MinIO endpoint、bucket、access key、secret key 和 path-style 选项仍然正确。

## 文件完整性

Release 会自动附加发布文件列表、文件大小、MD5、SHA256 和 `release-manifest.json`。下载后可使用下列命令校验：

```bash
md5sum -c MD5SUMS.txt
sha256sum -c SHA256SUMS.txt
```

Windows PowerShell 示例：

```powershell
Get-FileHash .\icedr_VERSION_windows-x86_64.exe -Algorithm SHA256
```

## Full Changelog

https://github.com/Cloudwhile/icedr/compare/v0.0.1-alpha.1...v0.0.1-alpha.2
