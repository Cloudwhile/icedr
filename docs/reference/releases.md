# 发布动态

ICEDR 的发布页提供 GitHub Release、校验文件、Docker 镜像和平台二进制文件。Docker Hub 镜像位置为 `corecherry/icedr-po`。

## 最新发布

<ClientOnly>
  <LatestRelease />
</ClientOnly>

## 发布文件

每次发布会附带：

- 平台二进制文件
- `MD5SUMS.txt`
- `SHA256SUMS.txt`
- `release-manifest.json`

## 版本标识

带有预发布标记的版本会作为 prerelease 处理，例如：

```text
v0.0.1-alpha.1
v1.2.0-beta.1
```

稳定版本会更新 `corecherry/icedr-po:latest`；预发布版本不会更新 `latest`。

## 文件完整性校验

下载二进制文件后，可以使用发布页附带的 MD5 或 SHA256 校验文件确认完整性。

Windows PowerShell 示例：

```powershell
Get-FileHash .\icedr_VERSION_windows-x86_64.exe -Algorithm MD5
```

Linux / macOS 示例：

```bash
md5sum ./icedr_VERSION_linux-x86_64
sha256sum ./icedr_VERSION_linux-x86_64
```
