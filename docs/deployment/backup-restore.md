# 备份与恢复

ICEDR 的完整数据由数据库、文件对象、运行配置和安全密钥组成。只有其中一部分的备份通常无法完整恢复目录树、版本、分享和审计记录。

## 需要备份什么

| 部署形态 | 必备内容 |
| --- | --- |
| SQLite + 本地存储 | 整个 `data` 目录、环境文件、部署配置 |
| PostgreSQL + 本地存储 | PostgreSQL 备份、`local-files`、环境文件、部署配置 |
| SQLite + S3 / MinIO | SQLite 与运行元数据、对象存储副本、环境文件 |
| PostgreSQL + S3 / MinIO | PostgreSQL 备份、对象存储副本、环境文件 |

`AUTH_SECURITY_SECRET`、SMTP、数据库和对象存储凭据应进入受控密钥备份，不要放入普通公开压缩包。

## 一致性原则

数据库记录与文件对象必须来自尽可能接近的同一时间点。备份过程中继续上传、删除或创建版本，可能产生数据库有记录但对象缺失，或对象存在但数据库没有引用的情况。

最安全的基础流程是：

1. 进入维护窗口，停止写入。
2. 停止 ICEDR 实例。
3. 备份数据库。
4. 备份本地文件或对象存储。
5. 备份环境与部署配置。
6. 启动 ICEDR 并完成快速验证。

## SQLite 与本地存储

停止容器：

```bash
docker stop icedr
```

备份整个数据目录：

```bash
sudo tar \
  --create \
  --gzip \
  --file=/srv/backup/icedr-data-$(date +%F-%H%M).tar.gz \
  --directory=/opt/icedr \
  data
```

备份环境文件：

```bash
sudo install -m 0600 /opt/icedr/icedr.env /srv/backup/icedr.env
```

重新启动：

```bash
docker start icedr
```

不要在 SQLite 正在写入时只复制 `icedr.sqlite`。

## PostgreSQL

按 [PostgreSQL 配置](/deployment/postgresql#备份) 使用 `pg_dump`。备份任务应记录：

- 开始和结束时间。
- 数据库版本。
- ICEDR 版本。
- 对应文件对象快照或镜像的标识。
- 校验值和保存位置。

## MinIO / S3

可以使用平台复制、快照、版本控制或 `mc mirror`。MinIO 示例：

```bash
mc mirror \
  --overwrite \
  --remove \
  icedr-minio/icedr-drive \
  icedr-backup/icedr-drive
```

`--remove` 会让目标镜像删除源端已不存在的对象。首次使用前应在测试 Bucket 验证，或者改用保留历史的备份策略。

对象存储备份必须位于不同故障域，不能只是在同一磁盘复制一个目录。

## 恢复 SQLite + 本地存储

1. 停止 ICEDR。
2. 保留当前故障目录的只读副本，便于后续取证。
3. 创建空的目标数据目录。
4. 解压备份到目标位置。
5. 恢复原环境文件和权限。
6. 使用备份时对应的 ICEDR 版本启动。
7. 检查日志后再升级到新版本。

示例：

```bash
docker stop icedr
sudo mv /opt/icedr/data /opt/icedr/data.failed
sudo tar --extract --gzip --file=/srv/backup/icedr-data-YYYY-MM-DD-HHMM.tar.gz --directory=/opt/icedr
sudo chown -R "$(id -u)":"$(id -g)" /opt/icedr/data
docker start icedr
```

执行移动前必须人工确认 `/opt/icedr/data` 是当前实例的真实数据目录。

## 恢复 PostgreSQL + 对象存储

1. 创建隔离的恢复环境。
2. 恢复对象存储副本或快照。
3. 恢复 PostgreSQL 到新的空数据库。
4. 使用备份时的环境变量连接恢复副本。
5. 启动与备份版本一致的 ICEDR。
6. 抽样验证文件内容、版本、分享和审计。
7. 确认无误后再切换正式流量。

不要先把空数据库接到正式对象存储，也不要让恢复测试写入唯一的备份副本。

## 恢复验收清单

- 管理员和普通登录方式可用。
- 工作区、用户、配额和站点设置存在。
- 随机抽查不同目录、大小和时间的文件。
- 历史版本可下载或恢复。
- 外链状态、有效期和权限正确。
- 审计记录时间连续。
- 新上传、预览、下载、删除和恢复成功。
- 重启后数据仍然存在。

建议至少每季度进行一次隔离恢复演练，并记录实际恢复时间。
