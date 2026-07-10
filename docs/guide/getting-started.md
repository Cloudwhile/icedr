# 快速开始

本页使用已发布的 Docker 镜像启动 ICEDR，并完成首次初始化和部署成功验证。需要 Compose、二进制或生产域名时，转到对应部署文档。

::: warning 使用固定的预发布版本
当前最新发布是 `v0.0.1-alpha.5`。预发布版本不会更新 Docker `latest` 标签，示例因此固定使用 `0.0.1-alpha.5`。
:::

## 启动 ICEDR

先创建持久化目录：

```bash
sudo mkdir -p /opt/icedr/data
sudo chown -R "$USER":"$USER" /opt/icedr
```

生成并保存生产环境安全密钥：

```bash
umask 077
printf 'AUTH_SECURITY_SECRET=%s\n' "$(openssl rand -hex 32)" > /opt/icedr/icedr.env
printf 'SMTP_ENABLED=false\n' >> /opt/icedr/icedr.env
```

`AUTH_SECURITY_SECRET` 必须长期保留。重新生成会使已有登录会话失效。

启动容器：

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

确认容器处于运行状态：

```bash
docker ps --filter name=icedr
docker logs --tail 100 icedr
```

浏览器打开：

```text
http://服务器地址:13000
```

在本机部署时使用 `http://localhost:13000`。

## 完成初始化向导

全新数据目录会进入初始化向导。首次试用可采用以下选择：

1. 数据库选择 SQLite。
2. 创建管理员账号，并保存恢复所需的信息。
3. 保留本地账号登录；OAuth 和 Passkey 可以稍后配置。
4. 暂不启用 SMTP。
5. 文件存储选择本地存储。
6. 设置站点名称并完成初始化。

每一步的生产选择见 [初始化向导](/guide/setup-wizard)。

## 部署成功验证流程

不要只以“首页能打开”作为部署成功标准。按下面顺序完成一次最小闭环：

### 1. 验证登录和系统状态

- 使用刚创建的管理员账号登录。
- 打开“管理面板 → 系统状态”。
- 确认运行状态正常，并能看到版本、内存和存储信息。
- 如果存储容量显示未知，先确认数据目录挂载和宿主机权限；对象存储容量指标属于可选配置。

### 2. 验证文件读写

- 创建一个测试文件夹。
- 上传一个小型文本或图片文件。
- 刷新页面，确认文件仍存在。
- 打开预览；不支持预览的格式应能正常下载。
- 重命名文件，再将其移入回收站并恢复。

### 3. 验证外链

- 为测试文件创建一个允许预览的外链。
- 在无痕窗口中打开链接，确认访问方式与管理员策略一致。
- 如果启用了下载，再完成一次下载。
- 撤销链接，确认原链接不再可用。

### 4. 验证审计记录

打开“管理面板 → 审计日志”，确认能找到上传、预览、分享、访问、下载或撤销等刚刚执行的事件。事件可能因页面刷新和服务写入有短暂延迟。

### 5. 验证持久化

重启容器：

```bash
docker restart icedr
```

重新登录后确认：

- 初始化向导没有再次出现。
- 管理员账号仍可登录。
- 测试文件、外链状态和审计记录仍存在。

如果重新进入初始化向导，通常是数据目录没有正确挂载。检查容器是否仍使用 `/opt/icedr/data:/workspace/backend/data`。

## 上线前必须补齐

- 配置 [反向代理](/deployment/reverse-proxy) 和 [HTTPS](/deployment/https)。
- 使用真实域名更新公开地址、OAuth 回调和 Passkey Origin。
- 按需求配置 [SMTP](/guide/admin/mail-settings)、[PostgreSQL](/deployment/postgresql) 或 [MinIO / S3](/deployment/minio-s3)。
- 完成一次 [备份与恢复](/deployment/backup-restore) 演练。
- 阅读 [安全部署建议](/reference/security)。

## 其他部署方式

| 场景 | 文档 |
| --- | --- |
| 使用 Compose 文件和 `.env` 管理配置 | [Docker Compose 部署](/deployment/docker-compose) |
| 不使用容器 | [二进制部署](/guide/binary) |
| 比较不同部署方式 | [部署方式对比](/guide/deployment) |
