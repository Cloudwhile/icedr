# 发布与校验

## 最新发布

::: warning v0.0.1-alpha.5 · Alpha 预发布
当前最新版本是 [v0.0.1-alpha.5](https://github.com/Cloudwhile/icedr/releases/tag/v0.0.1-alpha.5)，发布于 2026 年 6 月 15 日。它不是稳定版，不会更新 Docker `latest` 标签。部署时使用镜像标签 `0.0.1-alpha.5`。
:::

```bash
docker pull corecherry/icedr-po:0.0.1-alpha.5
```

<ClientOnly>
  <LatestRelease />
</ClientOnly>

## 发布渠道

Docker Hub：

```text
corecherry/icedr-po
```

GitHub Container Registry：

```text
ghcr.io/cloudwhile/icedr-po
```

二进制、校验文件和发布清单位于：

```text
https://github.com/Cloudwhile/icedr/releases
```

## 版本规则

| 类型 | 示例 | GitHub Release | Docker `latest` |
| --- | --- | --- | --- |
| 稳定版 | `v1.2.0` | 正式发布 | 更新 |
| Alpha | `v1.2.0-alpha.1` | 预发布 | 不更新 |
| Beta | `v1.2.0-beta.1` | 预发布 | 不更新 |

Docker 标签去掉前导 `v`。例如 `v0.0.1-alpha.5` 对应 `0.0.1-alpha.5`。

## 二进制文件选择

文件名格式：

```text
icedr_VERSION_PLATFORM
```

| 平台 | 后缀 |
| --- | --- |
| Linux x86_64 | `linux-x86_64` |
| Linux ARM64 | `linux-arm64` |
| Windows x86_64 | `windows-x86_64.exe` |
| Windows ARM64 | `windows-arm64.exe` |
| macOS Intel | `macos-x86_64` |
| macOS Apple Silicon | `macos-arm64` |

## SHA256 校验

SHA256 是主要完整性校验。MD5 只用于兼容旧工具，不用于判断文件是否可信。

Linux / macOS：

```bash
sha256sum ./icedr_0.0.1-alpha.5_linux-x86_64
grep icedr_0.0.1-alpha.5_linux-x86_64 SHA256SUMS.txt
```

Windows PowerShell：

```powershell
Get-FileHash .\icedr_0.0.1-alpha.5_windows-x86_64.exe -Algorithm SHA256
```

校验值不一致时立即删除文件并从 GitHub Release 重新下载，不要尝试运行。

## 发布清单

每个 Release 会包含：

- 平台二进制。
- 每个文件的 `.sha256` 和 `.md5`。
- 汇总的 `SHA256SUMS.txt` 与 `MD5SUMS.txt`。
- `release-manifest.json`。

发布清单用于核对文件名、大小、哈希和下载来源。

## 升级决策

升级前检查：

1. 当前版本与目标版本。
2. Release 是否为预发布。
3. 已知问题和配置变更。
4. 数据库迁移与回滚要求。
5. 当前备份是否已完成恢复演练。

操作步骤见 [升级迁移](/deployment/upgrade-migration)。
