# HTTPS 配置

公网部署应始终使用 HTTPS。Passkey、OAuth 回调、安全 Cookie 和邮箱链接都依赖稳定的 HTTPS Origin。

## Caddy 自动证书

域名正确解析且 `80`、`443` 可从公网访问时，Caddy 会自动申请和续期证书：

```text
drive.your-domain.tld {
    reverse_proxy 127.0.0.1:13000
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -n 100 --no-pager
```

## Nginx 与 Certbot

先按 [反向代理](/deployment/reverse-proxy#nginx-配置) 配置 HTTP 站点，再安装发行版提供的 Certbot 和 Nginx 插件：

```bash
sudo certbot --nginx -d drive.your-domain.tld
sudo certbot renew --dry-run
```

证书签发后再次执行 `nginx -t`，并确认 HTTP 会跳转到 HTTPS。

## 内网或私有 CA

内网环境可以使用组织 CA，但所有客户端必须信任该 CA。浏览器显示证书错误时，Passkey 和部分认证流程可能不可用，不应让用户长期忽略警告。

## 与认证配置保持一致

假设用户访问：

```text
https://drive.your-domain.tld
```

则应检查：

- Passkey RP ID：`drive.your-domain.tld`
- Passkey Origin：`https://drive.your-domain.tld`
- OAuth 回调：从 ICEDR 管理界面复制，不手工猜测路径
- CORS Origin：`https://drive.your-domain.tld`
- 外链基础地址：使用相同 HTTPS 域名

协议、域名和端口必须匹配。把 `http` 改为 `https` 后，应重新测试 OAuth 和 Passkey。

## 安全响应检查

浏览器开发者工具中确认：

- 页面没有混合加载 HTTP 资源。
- 登录和分享请求没有被重定向到内部端口。
- 外链复制结果使用 HTTPS。
- 证书链完整且未过期。

可以在确认所有子域都支持 HTTPS 后再启用 HSTS。过早启用包含子域的长期 HSTS 可能让尚未配置证书的其他服务无法访问。

## 证书续期监控

- 为证书到期设置监控告警。
- 定期检查 Certbot timer 或 Caddy 日志。
- 防火墙、DNS 或代理变更后执行一次续期测试。
- 备份私有 CA 配置；公开 CA 证书通常可以重新申请，不应把私钥放入公开仓库。
