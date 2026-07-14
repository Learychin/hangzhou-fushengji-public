# 杭州浮生记 Web MVP

这是 GitHub Pages 实际部署的静态生产目录。

## 已实现逻辑（MVP）

- 45 天回合制：点击站点移动一天，目标约 15 分钟完成一局
- 黑市价格生成（含每回合隐藏 3 种商品）
- 买入/卖出、库存与容量限制
- 债务利息（10%）与存款利息（1%）
- 商业随机事件、健康随机事件、偷抢类事件
- 银行存取款、邮局还债、医院治疗、租房扩容、网吧小收益
- 杭州地点流转
- 回合日志与最终结算
- Supabase 登录、每局结算保存、全服胜利榜

## 运行

在仓库根目录执行任意静态服务器，例如：

```bash
python3 -m http.server 8000
```

然后浏览器打开：

```text
http://127.0.0.1:8000
```

## 云端功能配置

当前测试项目：

- Supabase URL: `https://buxunkrlapndqqjfhkee.supabase.co`
- Project ref: `buxunkrlapndqqjfhkee`
- 本地测试地址: `http://127.0.0.1:8000`
- GitHub Pages: `https://learychin.github.io/hangzhou-fushengji-public/`
- 正式域名: `https://hz.qianbros.com`
- 管理后台: `https://hz.qianbros.com/admin.html`

### Supabase 初始化

1. 新建 Supabase 项目。
2. 安装并登录 Supabase CLI。
3. 执行 `supabase init --yes`。
4. 创建迁移文件，并执行 `supabase link --project-ref <project-ref>`。
5. 执行 `supabase db push` 推送迁移。
6. 复制 `config.example.js` 为 `config.js`。
7. 把 `config.js` 里的 `supabaseUrl` 和 `supabaseAnonKey` 替换为你的项目值。
8. 在 Supabase Authentication 的 URL Configuration 中加入本地和线上地址：

```text
http://127.0.0.1:8000
https://你的线上域名
```

当前 Supabase Auth 已配置：

- Site URL: `https://hz.qianbros.com`
- Redirect allow-list:
  - `http://127.0.0.1:8000`
  - `https://learychin.github.io/hangzhou-fushengji-public/`
  - `https://hz.qianbros.com`

本项目已经创建并推送了以下迁移：

- `supabase/migrations/20260505000100_game_auth_leaderboard.sql`
- `supabase/migrations/20260505002000_tighten_game_run_visibility.sql`
- `supabase/migrations/20260714150000_platform_foundation.sql`

### 本地验证

已验证：

- `node --check web_mvp/main.js`
- `node scripts/simulate_core_30turns.mjs`
- `node scripts/simulate_thumb_flow_30days.mjs`
- `node scripts/check_mobile_manifest.mjs`
- `node scripts/smoke_mobile_grid.mjs`（验证 360/390/430 三种手机视口、矩阵比例、零间隙、买卖切换、账号入口和 PWA 缓存）
- `leaderboard` 视图可用 public key 匿名读取
- 未登录用户不能写入 `game_runs`
- 首页可在 Chrome headless 中渲染游戏本体

### OAuth 登录

邮箱登录不需要额外 OAuth 配置。Google 登录已在 Supabase Authentication Providers 中启用。

OAuth secret、Supabase PAT、数据库密码和 service role key 不得提交到 GitHub。前端只能使用 publishable key。

### 部署

当前目录由 `.github/workflows/deploy-pages.yml` 作为完整静态站点部署。关键文件包括：

- `index.html`
- `main.js`
- `styles.css`
- `layout-v2.css`
- `platform.js`
- `config.js`

不要把 Supabase service role key 放进前端。这里只能使用 public anon key。
