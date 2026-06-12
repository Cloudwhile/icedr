# 二进制部署

ICEDR 的 GitHub Release 会提供平台二进制文件。二进制文件适合不运行 Docker、需要直接在服务器上启动 ICEDR 的部署场景。

## 支持的平台

当前发布流程生成下列平台：

| 平台 | 文件名后缀 |
| --- | --- |
| Linux x86_64 | `linux-x86_64` |
| Linux ARM64 | `linux-arm64` |
| Windows x86_64 | `windows-x86_64.exe` |
| Windows ARM64 | `windows-arm64.exe` |
| macOS x86_64 | `macos-x86_64` |
| macOS ARM64 | `macos-arm64` |

文件名规则：

```text
icedr_VERSION_PLATFORM
```

`VERSION` 是不带 `v` 前缀的发布版本，`PLATFORM` 是系统和 CPU 架构。

示例：

```text
icedr_VERSION_linux-x86_64
icedr_VERSION_windows-x86_64.exe
```

## 下载

前往项目 GitHub Release 页面：

```text
https://github.com/Cloudwhile/icedr/releases
```

选择与系统匹配的文件，同时下载：

- 对应平台二进制文件
- `MD5SUMS.txt`
- `SHA256SUMS.txt`
- `release-manifest.json`

人工确认完整性时，下载二进制文件和 `SHA256SUMS.txt` 通常即可。

## Linux 启动

创建目录：

```bash
sudo mkdir -p /opt/icedr
sudo chown "$USER":"$USER" /opt/icedr
```

把下载的文件放入 `/opt/icedr` 后，授予执行权限：

```bash
cd /opt/icedr
chmod +x ./icedr_VERSION_linux-x86_64
```

启动：

```bash
./icedr_VERSION_linux-x86_64
```

访问：

```text
http://服务器地址:13000
```

后台运行建议交给 systemd、supervisor 或进程管理器处理，避免长期依赖 SSH 会话中的前台进程。

## macOS 启动

把文件放到一个固定目录，例如：

```bash
mkdir -p "$HOME/Applications/icedr"
cd "$HOME/Applications/icedr"
chmod +x ./icedr_VERSION_macos-arm64
./icedr_VERSION_macos-arm64
```

如果 macOS 拦截未签名程序，需要在系统安全设置中允许该程序运行，或在终端中解除隔离属性：

```bash
xattr -d com.apple.quarantine ./icedr_VERSION_macos-arm64
```

## Windows 启动

建议创建目录：

```text
C:\ICEDR
```

把 `icedr_VERSION_windows-x86_64.exe` 放入该目录，然后在 PowerShell 中运行：

```powershell
cd C:\ICEDR
.\icedr_VERSION_windows-x86_64.exe
```

访问：

```text
http://localhost:13000
```

长期后台运行时，可以使用 Windows 服务管理工具、任务计划程序或进程守护工具。

## 数据目录

二进制文件默认在可执行文件所在目录创建 `data`：

```text
icedr_VERSION_linux-x86_64
data/
  icedr.sqlite
  local-files/
  native/
  database-source.json
```

二进制文件所在目录即默认数据目录的上级目录。升级时，将新二进制文件放到同一目录即可继续使用原来的 `data`。

如果要指定其他数据目录：

Linux / macOS：

```bash
ICEDR_DATA_DIR=/var/lib/icedr ./icedr_VERSION_linux-x86_64
```

Windows PowerShell：

```powershell
$env:ICEDR_DATA_DIR="D:\icedr-data"
.\icedr_VERSION_windows-x86_64.exe
```

## 常用环境变量

二进制部署和 Docker 部署使用同一套后端变量。最常用的是：

| 变量 | 用途 | 示例 |
| --- | --- | --- |
| `API_HOST` | 服务监听地址 | `0.0.0.0` |
| `API_PORT` | 服务监听端口 | `13000` |
| `PUBLIC_SHARE_BASE_URL` | 外链公开地址 | `https://drive.example.com/share/s` |
| `API_PUBLIC_BASE_URL` | API 公开地址 | `https://drive.example.com/api` |
| `API_CORS_ORIGIN` | 允许的浏览器来源 | `https://drive.example.com` |
| `ICEDR_DATA_DIR` | 二进制数据目录 | `/var/lib/icedr` |
| `LOCAL_STORAGE_ROOT` | 本地文件存储目录 | `/data/icedr-files` |
| `SQLITE_DATABASE_PATH` | SQLite 文件路径 | `/var/lib/icedr/icedr.sqlite` |

更多变量见 [配置说明](/reference/configuration)。

## 配置 PostgreSQL

不设置数据库变量时，ICEDR 使用 SQLite。要改用 PostgreSQL：

```bash
DATABASE_HOST=postgres.example.internal \
DATABASE_PORT=5432 \
DATABASE_DBNAME=icedr \
DATABASE_USER=icedr_app \
DATABASE_PASSWORD=strong-password \
./icedr_VERSION_linux-x86_64
```

也可以先启动 SQLite，在首次初始化向导的数据库步骤中填写 PostgreSQL 信息。

## 配置对象存储

不设置 S3 变量时，文件保存到本地 `data/local-files`。要使用 S3 / MinIO：

```bash
S3_ENDPOINT=https://s3.example.com \
S3_REGION=us-east-1 \
S3_BUCKET=icedr-drive \
S3_ACCESS_KEY_ID=your-access-key \
S3_SECRET_ACCESS_KEY=your-secret-key \
S3_FORCE_PATH_STYLE=true \
./icedr_VERSION_linux-x86_64
```

也可以在初始化向导中勾选对象存储后填写配置。未勾选时，系统不会要求对象存储参数。

## 校验下载文件

Linux / macOS：

```bash
sha256sum ./icedr_VERSION_linux-x86_64
grep icedr_VERSION_linux-x86_64 SHA256SUMS.txt
```

Windows PowerShell：

```powershell
Get-FileHash .\icedr_VERSION_windows-x86_64.exe -Algorithm SHA256
```

对比结果是否与 `SHA256SUMS.txt` 中相同。也可以用 `MD5SUMS.txt` 做兼容性校验，但 SHA256 更适合作为主要完整性检查。

## 升级

1. 停止当前 ICEDR 进程。
2. 备份 `data` 目录。
3. 下载新版本二进制文件和校验文件。
4. 校验文件完整性。
5. 把新二进制文件放到原目录。
6. 用同样的环境变量启动新版本。

保留 `data` 目录后，SQLite、本地文件和初始化状态都会保留。

## 常见问题

### 为什么 data 出现在可执行文件旁边

这是二进制部署的默认行为，便于复制、备份和迁移。需要放到别处时，使用 `ICEDR_DATA_DIR`。

### 首次启动后没有页面

确认端口是否被占用，或把端口改成其他值：

```bash
API_PORT=18000 ./icedr_VERSION_linux-x86_64
```

然后访问 `http://服务器地址:18000`。

### SMTP 是否必须配置

可以。SMTP 可以先关闭，之后在管理员设置里补齐。
