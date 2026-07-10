# 二进制部署

平台二进制把 ICEDR 网页、服务端和运行依赖封装为单个可执行文件，适合不能使用容器的服务器。数据默认保存在可执行文件旁的 `data` 目录。

## 下载当前版本

当前最新发布是 [v0.0.1-alpha.5](https://github.com/Cloudwhile/icedr/releases/tag/v0.0.1-alpha.5)。按系统选择：

| 平台 | 文件 |
| --- | --- |
| Linux x86_64 | `icedr_0.0.1-alpha.5_linux-x86_64` |
| Linux ARM64 | `icedr_0.0.1-alpha.5_linux-arm64` |
| Windows x86_64 | `icedr_0.0.1-alpha.5_windows-x86_64.exe` |
| Windows ARM64 | `icedr_0.0.1-alpha.5_windows-arm64.exe` |
| macOS x86_64 | `icedr_0.0.1-alpha.5_macos-x86_64` |
| macOS ARM64 | `icedr_0.0.1-alpha.5_macos-arm64` |

同时下载 `SHA256SUMS.txt`，并按 [发布与校验](/reference/releases) 验证文件完整性。

## Linux 安装

```bash
sudo useradd --system --home /var/lib/icedr --shell /usr/sbin/nologin icedr
sudo install -d -m 0750 -o icedr -g icedr /opt/icedr /var/lib/icedr /etc/icedr
sudo install -m 0755 ./icedr_0.0.1-alpha.5_linux-x86_64 /opt/icedr/icedr
```

生成环境文件：

```bash
umask 077
AUTH_SECRET="$(openssl rand -hex 32)"
sudo sh -c "printf '%s\n' \
  'NODE_ENV=production' \
  'APP_ENV=production' \
  'API_HOST=127.0.0.1' \
  'API_PORT=13000' \
  'ICEDR_DATA_DIR=/var/lib/icedr' \
  'SMTP_ENABLED=false' \
  'AUTH_SECURITY_SECRET=$AUTH_SECRET' > /etc/icedr/icedr.env"
sudo chmod 600 /etc/icedr/icedr.env
```

创建 `/etc/systemd/system/icedr.service`：

```ini
[Unit]
Description=ICEDR
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=icedr
Group=icedr
WorkingDirectory=/opt/icedr
EnvironmentFile=/etc/icedr/icedr.env
ExecStart=/opt/icedr/icedr
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now icedr
sudo systemctl status icedr
sudo journalctl -u icedr -n 100 --no-pager
```

服务只监听 `127.0.0.1:13000`，请继续配置 [反向代理](/deployment/reverse-proxy)。临时测试可以把 `API_HOST` 改为 `0.0.0.0`，并通过防火墙限制来源。

## Windows 启动

1. 创建 `C:\ICEDR` 和 `C:\ICEDR\data`。
2. 把二进制放入 `C:\ICEDR`。
3. 在 PowerShell 中设置生产变量并启动：

```powershell
$env:NODE_ENV = "production"
$env:APP_ENV = "production"
$env:API_HOST = "127.0.0.1"
$env:API_PORT = "13000"
$env:ICEDR_DATA_DIR = "C:\ICEDR\data"
$secretBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
$env:AUTH_SECURITY_SECRET = -join ($secretBytes | ForEach-Object { $_.ToString("x2") })
$env:SMTP_ENABLED = "false"
& "C:\ICEDR\icedr_0.0.1-alpha.5_windows-x86_64.exe"
```

长期运行时，把这些变量保存在受保护的服务配置中，并使用 Windows 服务管理工具守护进程；不要依赖交互式 PowerShell 窗口。

## macOS 启动

```bash
mkdir -p "$HOME/Applications/icedr"
chmod +x ./icedr_0.0.1-alpha.5_macos-arm64
AUTH_SECURITY_SECRET="$(openssl rand -hex 32)" \
  NODE_ENV=production \
  APP_ENV=production \
  SMTP_ENABLED=false \
  ./icedr_0.0.1-alpha.5_macos-arm64
```

如果系统阻止未签名程序，先核对 SHA256 和 Release 来源，再按 macOS 安全设置决定是否允许运行。

## 数据目录

```text
data/
  assets/
  icedr.sqlite
  local-files/
  native/
  database-source.json
```

使用 `ICEDR_DATA_DIR` 可以把数据移到独立磁盘。备份时应包含整个目录，而不只是 SQLite 文件。

## 升级

1. 停止 ICEDR 服务。
2. 备份数据目录和环境文件。
3. 下载并校验新二进制。
4. 保留旧二进制用于受控回滚。
5. 替换 `/opt/icedr/icedr` 或 Windows 可执行文件。
6. 使用原环境变量启动并检查日志。
7. 验证登录、文件、分享和审计。

数据库结构升级后，不要直接用旧程序连接新数据库。需要回滚时恢复升级前的数据库和文件备份。
