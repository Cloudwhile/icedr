# Docker 部署

Docker 镜像包含 ICEDR 网页和服务端。默认 SQLite、本地文件存储和初始化状态都位于容器内 `/workspace/backend/data`，必须映射到持久化目录。

## 镜像与版本

镜像发布到：

```text
corecherry/icedr-po
ghcr.io/cloudwhile/icedr-po
```

当前最新发布是预发布版本 `v0.0.1-alpha.5`，对应镜像标签：

```bash
docker pull corecherry/icedr-po:0.0.1-alpha.5
```

预发布版本不会更新 `latest`。重要环境始终固定具体标签。

## 准备目录和密钥

```bash
sudo install -d -m 0750 -o "$USER" -g "$USER" /opt/icedr/data
umask 077
printf 'AUTH_SECURITY_SECRET=%s\n' "$(openssl rand -hex 32)" > /opt/icedr/icedr.env
printf 'SHARE_VISITOR_HASH_SECRET=%s\n' "$(openssl rand -hex 32)" >> /opt/icedr/icedr.env
printf 'SMTP_ENABLED=false\n' >> /opt/icedr/icedr.env
```

`icedr.env` 包含长期安全密钥，应与数据一起纳入受控备份，但不要提交到代码仓库。

## 启动容器

直接通过服务器 IP 评估：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  --env-file /opt/icedr/icedr.env \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  corecherry/icedr-po:0.0.1-alpha.5
```

浏览器访问 `http://服务器地址:13000`。

通过同机反向代理上线时，建议只绑定回环地址：

```text
-p 127.0.0.1:13000:13000
```

然后按 [反向代理](/deployment/reverse-proxy) 配置域名。

## 数据目录

| 内容 | 宿主机位置 | 容器内位置 |
| --- | --- | --- |
| SQLite 数据库 | `/opt/icedr/data/icedr.sqlite` | `/workspace/backend/data/icedr.sqlite` |
| 本地文件 | `/opt/icedr/data/local-files` | `/workspace/backend/data/local-files` |
| 数据库来源记录 | `/opt/icedr/data/database-source.json` | `/workspace/backend/data/database-source.json` |

不要只备份数据库而遗漏 `local-files`，也不要只复制文件对象而遗漏数据库元数据。

## Docker Compose 示例

下面是可直接保存为 `compose.yaml` 的最小示例：

```yaml
services:
  icedr:
    image: corecherry/icedr-po:0.0.1-alpha.5
    container_name: icedr
    restart: unless-stopped
    ports:
      - "13000:13000"
    environment:
      NODE_ENV: production
      APP_ENV: production
      API_HOST: 0.0.0.0
      API_PORT: 13000
      AUTH_SECURITY_SECRET: ${AUTH_SECURITY_SECRET:?请在 .env 中设置安全密钥}
      SHARE_VISITOR_HASH_SECRET: ${SHARE_VISITOR_HASH_SECRET:?请在 .env 中设置独立的访客哈希密钥}
      SMTP_ENABLED: "false"
    volumes:
      - ./data:/workspace/backend/data
```

在同目录创建 `.env`，填写由 `openssl rand -hex 32` 生成的值：

```dotenv
AUTH_SECURITY_SECRET=替换为至少32字符的随机值
SHARE_VISITOR_HASH_SECRET=替换为另一个至少32字符的随机值
```

启动：

```bash
docker compose up -d
```

完整的域名、更新和运维流程见 [Docker Compose 部署](/deployment/docker-compose)。

## 常用操作

```bash
docker logs --tail 200 icedr
docker logs -f icedr
docker restart icedr
docker stop icedr
docker start icedr
```

查看容器健康状态：

```bash
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' icedr
```

## 生产域名变量

假设正式地址是 `https://drive.example.net`，在 `icedr.env` 中加入：

```dotenv
API_CORS_ORIGIN=https://drive.example.net
API_PUBLIC_BASE_URL=https://drive.example.net/api
PUBLIC_SHARE_BASE_URL=https://drive.example.net/share/s
```

请替换为真实域名。生产校验会拒绝 `example.com`、`localhost` 和常见占位值。

## 配置外部服务

- PostgreSQL：[PostgreSQL 配置](/deployment/postgresql)
- 对象存储：[MinIO / S3 配置](/deployment/minio-s3)
- SMTP：[邮件设置](/guide/admin/mail-settings)
- 完整变量：[环境变量速查表](/reference/environment-variables)

## 升级

1. 阅读 [发布与校验](/reference/releases)。
2. 完成 [备份与恢复](/deployment/backup-restore) 中的升级前备份。
3. 拉取新版本镜像。
4. 停止并删除旧容器，但保留 `/opt/icedr/data` 和 `icedr.env`。
5. 使用新标签和原参数重新创建容器。
6. 检查日志并执行最小验证流程。

删除容器不会删除绑定到宿主机的 `/opt/icedr/data`，但执行前仍应确认备份。

## 常见问题

### 启动后立即退出

查看 `docker logs icedr`。生产模式最常见原因是缺少两个独立的安全密钥、变量仍为占位值、端口无效或数据目录不可写。

### 重启后再次进入初始化向导

确认仍然挂载：

```text
/opt/icedr/data:/workspace/backend/data
```

同时检查宿主机目录是否实际包含原数据库文件。

### 上传失败

检查工作区配额、宿主机磁盘、目录权限、反向代理限制和存储后端状态。完整矩阵见 [故障排查](/reference/troubleshooting)。
