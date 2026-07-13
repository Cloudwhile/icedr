# MinIO / S3 配置

对象存储保存文件内容，ICEDR 数据库保存目录树、文件元数据、版本、分享和审计信息。两者必须作为同一套数据备份和恢复。

## 适用场景

- 文件容量超过单机磁盘规划。
- 已有 MinIO、S3 或兼容对象存储平台。
- 需要独立的对象生命周期、复制、快照或容量监控。

小型单机部署也可以继续使用本地文件存储，不必为了“生产”标签强制引入对象存储。

## MinIO 快速准备

以下示例假设 MinIO 已单独部署。使用 `mc` 创建别名和私有 Bucket：

```bash
mc alias set icedr-minio https://minio.your-domain.tld MINIO_ADMIN_USER MINIO_ADMIN_PASSWORD
mc mb --ignore-existing icedr-minio/icedr-drive
mc anonymous set none icedr-minio/icedr-drive
```

不要把 MinIO 管理员账号配置给 ICEDR。创建专用服务账号，并只授予目标 Bucket 所需权限。

最小权限通常需要：

- 列出目标 Bucket。
- 读取、写入和删除目标 Bucket 内对象。
- 处理分片上传及其中止操作。

具体策略语法取决于 MinIO 或云厂商版本。保存后用专用账号执行一次上传和删除测试。

## ICEDR 配置

MinIO 示例：

```dotenv
S3_ENDPOINT=https://minio.internal.your-domain.tld
S3_PUBLIC_ENDPOINT=https://objects.your-domain.tld
S3_REGION=us-east-1
S3_BUCKET=icedr-drive
S3_ACCESS_KEY_ID=填写专用AccessKey
S3_SECRET_ACCESS_KEY=填写专用SecretKey
S3_FORCE_PATH_STYLE=true
```

AWS S3 示例通常不需要自定义 Endpoint，并可关闭 Path Style；兼容服务是否支持虚拟主机模式以供应商文档为准。

字段含义：

| 字段 | 说明 |
| --- | --- |
| Endpoint | ICEDR 服务端访问对象存储的地址 |
| Public Endpoint | 浏览器需要访问对象时使用的公开地址，可选 |
| Region | Bucket 所在区域 |
| Bucket | 专用于 ICEDR 的私有 Bucket |
| Access / Secret Key | 专用服务账号凭据 |
| Path Style | MinIO 通常设为 `true` |

## 在管理面板中切换

1. 打开“系统设置 → 平台配置 → 存储后端”。
2. 选择 S3 / MinIO。
3. 填写连接参数和新的 Secret。
4. 执行连接测试。
5. 保存并切换。
6. 上传、预览、下载和删除一个测试文件。

切换只影响新上传文件，旧文件不会自动从本地目录迁移。旧后端必须保留到迁移和校验完成。

## 容量指标

如需在系统状态显示 MinIO 容量，可以配置：

```dotenv
MINIO_METRICS_ENDPOINT=https://minio.internal.your-domain.tld/minio/metrics/v3/cluster/health
MINIO_METRICS_BEARER_TOKEN=填写只读指标令牌
```

指标令牌只用于读取容量，不应复用对象读写密钥。未配置指标时显示未知容量，不影响文件操作。

## 网络与 TLS

- ICEDR 主机必须能解析并访问 Endpoint。
- 使用私有 CA 时，把 CA 正确安装到运行环境，不要关闭 TLS 校验。
- Public Endpoint 必须从用户浏览器可访问。
- 不要向公网暴露 MinIO 管理控制台，除非另有强认证和访问控制。

## 备份

仅开启 Bucket Versioning 不能替代备份。建议使用 MinIO 站点复制、对象锁定、快照或 `mc mirror` 把对象复制到独立故障域，并在同一恢复点备份 ICEDR 数据库。

完整流程见 [备份与恢复](/deployment/backup-restore)。

## 常见故障

| 现象 | 检查 |
| --- | --- |
| 连接测试失败 | Endpoint、DNS、TLS、Access Key 和 Bucket 权限 |
| 上传成功但浏览器打不开 | Public Endpoint、证书、反向代理和跨域来源 |
| 只能上传不能删除 | 服务账号缺少删除或分片上传权限 |
| 容量显示未知 | 指标地址或只读令牌未配置 |
| 旧文件打不开 | 切换后过早移除了旧存储后端 |
