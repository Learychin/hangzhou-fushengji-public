# 腾讯云迁移清单（hz.qianbros.com）

目标：把网页游戏从 GitHub Pages 迁到腾讯云 CloudBase 静态托管，解决 `https` 不安全提示与访问速度波动。

## 0. 准备

- 已有 CloudBase 环境（当前项目已有：`hangshoufushengji-d5dnf0f65236ad`）。
- 本地已安装 `tcb` CLI。
- 确保能登录：`tcb login`。

## 1. 部署静态站

在仓库根目录执行：

```bash
./scripts/deploy_tencent_hosting.sh hangshoufushengji-d5dnf0f65236ad
```

说明：
- 会把 `web_mvp/` 上传为静态托管根目录。
- 不改变 Supabase 的后端配置。

## 2. CloudBase 绑定域名

在腾讯云 CloudBase 控制台：

1. 打开你的环境 -> 静态托管 -> 自定义域名
2. 新增域名：`hz.qianbros.com`
3. 记录系统给出的 CNAME 目标（例如 `xxxx.tcloudbaseapp.com`）
4. 开启 HTTPS（证书可用腾讯云托管证书或上传自有证书）

## 3. GoDaddy 切 DNS

把当前 `hz` 记录从：
- `learychin.github.io`

改为：
- CloudBase 提供的 CNAME 目标（第 2 步拿到）

注意：
- `hz` 下只能保留一条 CNAME。
- 保留根域 `@` 的记录可不动（当前你网站主流量走 `hz`）。

## 4. 验证

等待 DNS 生效后（通常几分钟到 30 分钟）：

```bash
dig +short hz.qianbros.com
curl -I https://hz.qianbros.com
```

预期：
- `dig` 返回 CloudBase 的域名/解析目标
- `curl` 返回 `200` 且证书匹配 `hz.qianbros.com`

## 5. 回滚预案

如果迁移中出现异常：
- 把 GoDaddy 的 `hz` CNAME 改回 `learychin.github.io`
- GitHub Pages 即可恢复服务（当前 public 仓库持续可用）

