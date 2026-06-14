# 发布与校验

ICEDR 的 GitHub Release 会同时提供：

- 平台二进制文件
- `MD5SUMS.txt`
- `SHA256SUMS.txt`
- `release-manifest.json`

Docker 镜像发布到 Docker Hub：

```text
corecherry/icedr-po
```

同时发布到 GitHub Container Registry：

```text
ghcr.io/cloudwhile/icedr-po
```

## 最新发布

<ClientOnly>
  <LatestRelease />
</ClientOnly>

## 版本标签

稳定版本示例：

```text
v1.2.0
```

预发布版本示例：

```text
v1.2.0-alpha.1
v1.2.0-beta.1
```

带 `-alpha.*`、`-beta.*` 等预发布标记的版本会作为 GitHub prerelease 处理。预发布版本会发布对应 Docker 标签，但不会更新 `latest`。

Docker 镜像使用不带 `v` 的版本号：

```bash
docker pull corecherry/icedr-po:VERSION
```

例如 GitHub Release 标签 `v1.2.0-alpha.1` 对应 Docker 镜像标签 `1.2.0-alpha.1`。

GitHub Release 标签仍然使用：

```text
v1.2.0-alpha.1
```

## Release 文件选择

二进制文件名规则：

```text
icedr_VERSION_PLATFORM
```

`VERSION` 不包含 `v` 前缀，`PLATFORM` 表示系统和 CPU 架构。

示例：

| 系统 | 下载文件 |
| --- | --- |
| Linux x86_64 | `icedr_VERSION_linux-x86_64` |
| Linux ARM64 | `icedr_VERSION_linux-arm64` |
| Windows x86_64 | `icedr_VERSION_windows-x86_64.exe` |
| Windows ARM64 | `icedr_VERSION_windows-arm64.exe` |
| macOS x86_64 | `icedr_VERSION_macos-x86_64` |
| macOS ARM64 | `icedr_VERSION_macos-arm64` |

平台选择参考：

- 普通 Intel / AMD Linux 服务器：通常选 `linux-x86_64`。
- ARM 云服务器或树莓派 64 位系统：通常选 `linux-arm64`。
- Intel Mac：选 `macos-x86_64`。
- Apple Silicon Mac：选 `macos-arm64`。
- 现代 Windows PC：通常选 `windows-x86_64.exe`。

## 校验文件完整性

推荐使用 SHA256。MD5 主要用于兼容旧工具或快速比对。

Linux / macOS：

```bash
sha256sum ./icedr_VERSION_linux-x86_64
grep icedr_VERSION_linux-x86_64 SHA256SUMS.txt
```

Windows PowerShell：

```powershell
Get-FileHash .\icedr_VERSION_windows-x86_64.exe -Algorithm SHA256
```

如果得到的哈希值和 `SHA256SUMS.txt` 中对应文件一致，说明文件下载完整。

MD5 示例：

```powershell
Get-FileHash .\icedr_VERSION_windows-x86_64.exe -Algorithm MD5
```

## release-manifest.json

`release-manifest.json` 适合自动化脚本读取。它记录发布文件、大小、哈希和下载地址。专业用户可以用它做自动更新、镜像同步或资产审计。

## Docker latest 规则

| 版本类型 | 示例 | 是否更新 `latest` |
| --- | --- | --- |
| 稳定版本 | `v1.2.0` | 是 |
| Alpha | `v1.2.0-alpha.1` | 否 |
| Beta | `v1.2.0-beta.1` | 否 |

生产环境建议固定版本号以获得更可控的部署结果：

```bash
docker pull corecherry/icedr-po:VERSION
```

## 更新检查

ICEDR 系统状态页会显示当前版本，并可检查是否有新版本。

规则：

- 当前是稳定版本时，默认只把新的稳定版本视为可更新版本。
- 当前是预发布版本时，可以识别新的预发布版本和稳定版本。
- 使用自定义发布源时，可以设置 `ICEDR_UPDATE_CHECK_URL`。
- 如果稳定版本也希望检查预发布版本，可以设置 `ICEDR_UPDATE_INCLUDE_PRERELEASES=true`。

## Release 文件缺失处理

可能原因：

- 当前 Release 仍在构建中。
- 当前打开的是源码标签页，不是 Release 页面。
- 该平台暂未发布二进制文件。
- 预发布版本没有 `latest` Docker 标签，需要使用具体版本号。

建议先刷新 Release 页面，再查看页面中的资产列表和 `release-manifest.json`。
