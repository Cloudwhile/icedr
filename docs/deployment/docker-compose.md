# Docker Compose 部署

Compose 适合把镜像版本、环境变量、端口和持久化目录保存在一份声明式配置中。下面示例只运行 ICEDR；PostgreSQL 和 MinIO 可以作为独立服务接入。

## 创建目录

```bash
sudo install -d -m 0750 -o "$USER" -g "$USER" /opt/icedr/data
cd /opt/icedr
```

## 创建 `.env`

```bash
umask 077
printf 'ICEDR_VERSION=0.0.1-alpha.5\n' > .env
printf 'AUTH_SECURITY_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
printf 'ICEDR_HTTP_PORT=13000\n' >> .env
```

不要在每次 `up` 前重新生成 `AUTH_SECURITY_SECRET`。它应稳定保存并受到与管理员凭据相当的保护。

## 创建 `compose.yaml`

```yaml
services:
  icedr:
    image: corecherry/icedr-po:${ICEDR_VERSION}
    container_name: icedr
    restart: unless-stopped
    ports:
      - "${ICEDR_HTTP_PORT}:13000"
    environment:
      NODE_ENV: production
      APP_ENV: production
      API_HOST: 0.0.0.0
      API_PORT: 13000
      AUTH_SECURITY_SECRET: ${AUTH_SECURITY_SECRET:?AUTH_SECURITY_SECRET 未设置}
      SMTP_ENABLED: "false"
    volumes:
      - ./data:/workspace/backend/data
```

如果同机使用反向代理，把端口改为：

```yaml
ports:
  - "127.0.0.1:${ICEDR_HTTP_PORT}:13000"
```

## 启动与检查

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail 100 icedr
```

先执行 `docker compose config` 可以发现缺失变量和 YAML 缩进问题。该命令可能展开敏感变量，不要把完整输出发送到公开渠道。

## 添加正式域名

在 `.env` 中加入真实域名：

```dotenv
ICEDR_PUBLIC_ORIGIN=https://drive.your-domain.tld
```

在 `compose.yaml` 的 `environment` 中加入：

```yaml
API_CORS_ORIGIN: ${ICEDR_PUBLIC_ORIGIN}
API_PUBLIC_BASE_URL: ${ICEDR_PUBLIC_ORIGIN}/api
PUBLIC_SHARE_BASE_URL: ${ICEDR_PUBLIC_ORIGIN}/share/s
```

然后执行：

```bash
docker compose up -d
```

正式域名还需要 [反向代理](/deployment/reverse-proxy) 和 [HTTPS](/deployment/https)。

## 常用运维命令

```bash
docker compose ps
docker compose logs -f icedr
docker compose restart icedr
docker compose stop
docker compose start
```

不要使用 `docker compose down -v`，除非已经确认要删除命名 volume。本文使用绑定目录 `./data`，执行任何清理前仍应核对绝对路径。

## 升级

1. 备份 `/opt/icedr/data`、`.env` 和 `compose.yaml`。
2. 把 `.env` 中 `ICEDR_VERSION` 改为目标版本。
3. 执行：

```bash
docker compose pull
docker compose up -d
docker compose logs --tail 200 icedr
```

4. 完成登录、文件、分享和审计验证。

详细回滚要求见 [升级迁移](/deployment/upgrade-migration)。

## 接入外部服务

在 Compose 网络中，PostgreSQL 或 MinIO 的主机名可以使用其服务名；在独立主机上则使用内部 DNS 名称。无论位置如何，都应使用专用账号、私有网络和独立备份。

- [PostgreSQL 配置](/deployment/postgresql)
- [MinIO / S3 配置](/deployment/minio-s3)
- [环境变量速查表](/reference/environment-variables)
