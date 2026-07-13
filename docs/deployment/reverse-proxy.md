# 反向代理

反向代理负责把正式域名的请求转发到 ICEDR，并保留客户端地址、协议和主机信息。ICEDR 页面与服务端应作为同一个站点转发，不需要拆成多个公开上游。

## 上线前准备

- ICEDR 已在 `127.0.0.1:13000` 或受保护的内网地址运行。
- DNS 已把域名指向代理服务器。
- 防火墙只公开 `80` 和 `443`，不直接公开数据库、MinIO 或内部应用端口。
- 正式公开地址变量使用同一个 HTTPS 域名。

以下示例使用 `drive.your-domain.tld`，请完整替换为真实域名。

## Nginx 配置

保存为 `/etc/nginx/conf.d/icedr.conf` 或发行版对应的站点文件：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name drive.your-domain.tld;

    client_max_body_size 0;
    client_body_timeout 3600s;
    send_timeout 3600s;

    location / {
        proxy_pass http://127.0.0.1:13000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

检查并重新加载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

`client_max_body_size 0` 表示 Nginx 不额外限制上传大小。实际上传仍受 ICEDR 配额、磁盘和上游网络限制。如果组织要求明确上限，可以改成例如 `20g`。

## Caddy 配置

Caddy 默认可以自动申请和续期证书。保存为 `/etc/caddy/Caddyfile`：

```text
drive.your-domain.tld {
    encode zstd gzip

    reverse_proxy 127.0.0.1:13000 {
        transport http {
            dial_timeout 10s
            response_header_timeout 1h
        }
    }
}
```

检查并重新加载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy 默认不设置较小的请求体上限。若在 Caddy 前还有 CDN、WAF 或云负载均衡，需要同时检查那些层的上传限制和超时。

## ICEDR 公开地址

使用正式域名时设置：

```dotenv
API_CORS_ORIGIN=https://drive.your-domain.tld
API_PUBLIC_BASE_URL=https://drive.your-domain.tld/api
PUBLIC_SHARE_BASE_URL=https://drive.your-domain.tld/share/s
```

这些值用于同源校验、分享链接和认证回调，必须与浏览器实际访问地址一致。

## 验证代理

1. 通过域名打开登录页，不再直接使用端口地址。
2. 登录并上传一个小文件。
3. 上传一个较大测试文件，确认没有 `413`、`502` 或超时。
4. 下载文件并确认文件大小一致。
5. 创建外链，确认复制出的域名正确。
6. 查看审计日志中的客户端 IP 是否符合代理链预期。

## 多层代理

使用 CDN 或负载均衡时，应明确哪一层可信任客户端 IP，并防止公网客户端自行伪造转发头。只让受信任代理连接 ICEDR 上游端口，其他来源由防火墙拒绝。

HTTPS 与证书配置见 [HTTPS 配置](/deployment/https)。
