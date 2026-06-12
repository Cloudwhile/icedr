# 快速开始

本页面面向首次部署 ICEDR 的场景。默认流程无需预先理解数据库、对象存储或构建流程；选择运行方式后，按初始化向导完成设置即可。

## 选择运行方式

| 目标 | 推荐文档 | 适合场景 |
| --- | --- | --- |
| 使用已发布的 Docker 镜像 | [Docker 部署](/guide/docker) | 服务器已有 Docker，需要最少命令启动 |
| 使用已发布的二进制文件 | [二进制部署](/guide/binary) | 不运行容器，直接执行一个文件 |
| 从源码构建 | README | 开发、调试、二次开发 |

多数部署建议优先选择 Docker。Docker 镜像已经包含前端页面和后端 API，无需额外准备 Nginx，也无需分开部署前端和后端。

## 首次启动后做什么

启动成功后，打开：

```text
http://服务器地址:13000
```

如果是在本机运行，可以打开：

```text
http://localhost:13000
```

第一次访问会进入初始化向导。向导包含：

1. 确认数据库。默认使用本地 SQLite；需要 PostgreSQL 时再切换。
2. 创建管理员账号。
3. 选择登录方式。常规部署可以先保留本地账号登录。
4. 选择是否启用邮件。SMTP 可以先关闭，之后在管理员设置中配置。
5. 选择文件存储。默认使用本地文件存储；启用 S3 / MinIO 前需要先填写对象存储参数。
6. 设置站点名称和登录页标识。

完成后，系统会自动登录管理员账号。

## 数据保存在哪里

ICEDR 默认把运行数据放在 `data` 中：

| 数据 | 默认位置 |
| --- | --- |
| SQLite 数据库 | `data/icedr.sqlite` |
| 本地上传文件 | `data/local-files` |
| 二进制运行时原生模块 | `data/native` |
| 已保存的数据库切换信息 | `data/database-source.json` |

Docker 部署时，这些路径位于容器内 `/workspace/backend/data`。推荐用 `docker run -v /opt/icedr/data:/workspace/backend/data` 映射到宿主机本地目录。

二进制部署时，默认会在可执行文件所在目录创建 `data` 目录。例如可执行文件放在 `/opt/icedr/icedr_0.0.1-alpha.1_linux-x86_64`，数据会写入 `/opt/icedr/data`。

## 什么时候需要额外配置

试用阶段可以不配置 PostgreSQL、对象存储、Redis、SMTP 或 OAuth。

生产使用时，建议按需要补齐：

- 公网访问地址：用于外链、回调地址和反向代理。
- 邮件 SMTP：用于邮箱验证、外链身份确认和通知。
- PostgreSQL：适合多人、长期运行和更完整的备份策略。
- S3 / MinIO：适合把文件放到对象存储，而不是服务器本地磁盘。
- OIDC：适合接入组织已有账号系统。

完整变量说明见 [配置说明](/reference/configuration)。
