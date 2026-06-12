# Docker 部署

ICEDR 的 Docker 镜像把前端页面和后端 API 打包在同一个应用容器中。默认只需运行 ICEDR 镜像本身；PostgreSQL、Redis、MinIO、SMTP 等外部服务不是必需项，可按部署场景配置。

## 镜像位置

Docker Hub：

```text
corecherry/icedr-po
```

GitHub Container Registry：

```text
ghcr.io/cloudwhile/icedr-po
```

拉取稳定版本：

```bash
docker pull corecherry/icedr-po:latest
```

拉取预发布版本时，请使用具体版本号：

```bash
docker pull corecherry/icedr-po:0.0.1-alpha.1
```

预发布版本不会更新 `latest` 标签。生产环境建议固定具体版本号。

## 推荐启动命令

推荐把持久化数据映射到宿主机目录。Linux 服务器示例：

```bash
mkdir -p /opt/icedr/data

docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:latest
```

访问：

```text
http://localhost:13000
```

如果部署在服务器上，把 `localhost` 换成服务器 IP 或域名。

## GHCR 启动命令

使用 GitHub Container Registry 时，仅替换镜像名：

```bash
mkdir -p /opt/icedr/data

docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e SMTP_ENABLED=false \
  ghcr.io/cloudwhile/icedr-po:latest
```

## 持久化目录

容器内数据目录是：

```text
/workspace/backend/data
```

推荐映射到宿主机：

```text
/opt/icedr/data
```

默认情况下，下列数据会保存在该目录中：

| 数据 | 宿主机位置 | 容器内位置 |
| --- | --- | --- |
| SQLite 数据库 | `/opt/icedr/data/icedr.sqlite` | `/workspace/backend/data/icedr.sqlite` |
| 本地文件存储 | `/opt/icedr/data/local-files` | `/workspace/backend/data/local-files` |
| 数据库来源记录 | `/opt/icedr/data/database-source.json` | `/workspace/backend/data/database-source.json` |

升级或迁移前，优先备份 `/opt/icedr/data`。

Windows 示例：

```powershell
docker run -d `
  --name icedr `
  --restart unless-stopped `
  -p 13000:13000 `
  -v C:\ICEDR\data:/workspace/backend/data `
  -e NODE_ENV=production `
  -e APP_ENV=production `
  -e API_HOST=0.0.0.0 `
  -e API_PORT=13000 `
  -e SMTP_ENABLED=false `
  corecherry/icedr-po:latest
```

## 常用操作

查看日志：

```bash
docker logs -f icedr
```

停止：

```bash
docker stop icedr
```

启动：

```bash
docker start icedr
```

删除容器但保留宿主机数据：

```bash
docker rm -f icedr
```

保留 `/opt/icedr/data` 后，重新创建容器仍会继续使用原有数据。

## 指定端口

把宿主机端口改成 `8080`：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 8080:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:latest
```

访问：

```text
http://localhost:8080
```

`-p 8080:13000` 的意思是：宿主机 `8080` 转发到容器内 `13000`。

## 生产环境推荐命令

如果通过域名访问，例如 `https://drive.example.com`，建议同时设置公开地址：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e API_CORS_ORIGIN=https://drive.example.com \
  -e API_PUBLIC_BASE_URL=https://drive.example.com/api \
  -e PUBLIC_SHARE_BASE_URL=https://drive.example.com/share/s \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:latest
```

说明：

- `PUBLIC_SHARE_BASE_URL` 用来生成外链地址。
- `API_PUBLIC_BASE_URL` 用来告诉系统外部访问 API 的地址。
- `API_CORS_ORIGIN` 用来限制允许访问 API 的浏览器来源。
- `SMTP_ENABLED=false` 表示暂不启用邮件。之后可以在管理员设置中配置 SMTP。

## 配置邮件 SMTP

需要外链邮箱验证或邮件通知时，启用 SMTP：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e SMTP_ENABLED=true \
  -e SMTP_HOST=smtp.example.com \
  -e SMTP_PORT=587 \
  -e SMTP_SECURE=false \
  -e SMTP_USERNAME=notice@example.com \
  -e SMTP_PASSWORD=your-password \
  -e SMTP_FROM_NAME=ICEDR \
  -e SMTP_FROM_EMAIL=notice@example.com \
  corecherry/icedr-po:latest
```

邮件服务要求 465 端口和 TLS 时，通常使用：

```text
SMTP_PORT=465
SMTP_SECURE=true
```

## 使用 PostgreSQL

ICEDR 默认使用 SQLite。需要 PostgreSQL 时，可以在首次初始化向导的数据库步骤里填写连接信息，也可以用环境变量提供：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e DATABASE_HOST=postgres.example.internal \
  -e DATABASE_PORT=5432 \
  -e DATABASE_DBNAME=icedr \
  -e DATABASE_USER=icedr_app \
  -e DATABASE_PASSWORD=strong-password \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:latest
```

没有 PostgreSQL 备份方案时，建议先使用默认 SQLite；准备好数据库和备份策略后再切换。

## 使用 S3 / MinIO 对象存储

没有配置对象存储时，文件保存在本地 `/opt/icedr/data/local-files`。需要把文件放到 S3、MinIO 或兼容对象存储时，配置：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e S3_ENDPOINT=https://s3.example.com \
  -e S3_REGION=us-east-1 \
  -e S3_BUCKET=icedr-drive \
  -e S3_ACCESS_KEY_ID=your-access-key \
  -e S3_SECRET_ACCESS_KEY=your-secret-key \
  -e S3_FORCE_PATH_STYLE=true \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:latest
```

MinIO 常用 `S3_FORCE_PATH_STYLE=true`。AWS S3 通常可以使用 `false`，但不同网关实现可能不同。

对象存储也可以在首次初始化向导中启用。未勾选对象存储时，向导不会要求填写这些参数。

## 反向代理建议

如果通过域名访问，例如：

```text
https://drive.example.com
```

反向代理应把所有请求转发到 ICEDR 容器端口。ICEDR 已经把页面和 `/api` 放在同一个服务里，不需要额外拆成两个上游。

同时设置：

```text
PUBLIC_SHARE_BASE_URL=https://drive.example.com/share/s
API_PUBLIC_BASE_URL=https://drive.example.com/api
API_CORS_ORIGIN=https://drive.example.com
```

上传大文件时，反向代理需要允许足够大的请求体和足够长的超时时间。

## 升级

1. 备份 `/opt/icedr/data`。
2. 拉取新镜像：

```bash
docker pull corecherry/icedr-po:<new-version>
```

3. 删除旧容器：

```bash
docker rm -f icedr
```

4. 使用新标签重新运行，继续挂载同一个数据目录：

```bash
docker run -d \
  --name icedr \
  --restart unless-stopped \
  -p 13000:13000 \
  -v /opt/icedr/data:/workspace/backend/data \
  -e NODE_ENV=production \
  -e APP_ENV=production \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=13000 \
  -e SMTP_ENABLED=false \
  corecherry/icedr-po:<new-version>
```

5. 查看日志确认启动完成。

## 可选：仓库内 Compose 文件

仓库仍然保留 `deploy/docker-compose.yml`，用于本地构建或开发者需要 Compose 的场景。常规部署优先使用上面的 `docker run` 命令。

## 常见问题

### 打开页面后仍然进入初始化向导

通常说明当前容器没有挂载到原来的宿主机数据目录。确认启动命令里仍然包含：

```text
-v /opt/icedr/data:/workspace/backend/data
```

### 生产环境提示配置不合法

ICEDR 会拒绝明显的占位值、localhost 公网地址、错误端口和生产环境开发邮件模式。把日志里的变量名改成真实值后再启动。

### SMTP 是否必须配置

可以。设置 `SMTP_ENABLED=false`，或者在首次初始化向导中保持邮件关闭。需要邮箱验证时再配置 SMTP。
