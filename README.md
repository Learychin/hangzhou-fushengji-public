# 杭州浮生记

移动优先的 45 天文字模拟经营游戏。生产站点由 `web_mvp/` 提供，推送到 `main` 后经验证自动部署到 GitHub Pages。

## 访问入口

- 游戏：`https://hz.qianbros.com/`
- 管理后台：`https://hz.qianbros.com/admin.html`
- GitHub Pages：`https://learychin.github.io/hangzhou-fushengji-public/`

## 已实现

- 游客打开即玩，结算后可登记昵称并公开上榜
- 每局私有自动归档，玩家明确提交后才公开到排行榜
- 账号登录、排行榜、微信链接分享和断网待上传
- 管理后台查看玩家、全部对局、事件统计和逐步复盘
- 城市版本与 IP 路由；城市 JSON 可驱动下一局的 12 个地点、区域标签、商品参数和城市新闻
- 优惠券、本地活动、赞助新闻和赞助商品投放框架；新闻广告会随随机行情按权重与频控触发
- 随机新闻弹窗驱动商品价格波动

## 本地预览

```bash
python3 -m http.server 8878 --bind 0.0.0.0 --directory web_mvp
```

## 验证

```bash
node --check web_mvp/main.js
node --check web_mvp/platform.js
node --check web_mvp/admin.js
node scripts/check_mobile_manifest.mjs
node scripts/simulate_core_30turns.mjs
node scripts/simulate_thumb_flow_30days.mjs
node scripts/smoke_mobile_grid.mjs
```

## 后端发布

```bash
supabase link --project-ref buxunkrlapndqqjfhkee
supabase db push --linked
supabase functions deploy resolve-city --project-ref buxunkrlapndqqjfhkee --no-verify-jwt --use-api
```

前端只使用 Supabase publishable key。PAT、数据库密码和 service role key 不得进入仓库。
