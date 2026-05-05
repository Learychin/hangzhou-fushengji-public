# 北京浮生记 Web MVP

这是一个可直接在浏览器运行的前端 MVP，用于优先验证核心玩法闭环。

## 已实现逻辑（MVP）

- 45 天回合制：点击站点移动一天
- 黑市价格生成（含每回合隐藏 3 种商品）
- 买入/卖出、库存与容量限制
- 债务利息（10%）与存款利息（1%）
- 商业随机事件、健康随机事件、偷抢类事件
- 银行存取款、邮局还债、医院治疗、租房扩容、网吧小收益
- 杭州地点流转
- 回合日志与最终结算
- Supabase 登录、每局结算保存、全服胜利榜

## 运行

在仓库根目录执行：

```bash
./scripts/run_web_mvp.sh
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
- Netlify 地址: `https://hz-qianbros.netlify.app`
- 正式域名: `https://hz.qianbros.com`

### 你需要提供

1. 如果启用 Apple 登录：Apple Developer 账号、Services ID、Team ID、Key ID、私钥。
2. 排行榜昵称规则、隐私政策页面、用户协议页面。

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
  - `https://hz-qianbros.netlify.app`
  - `https://hz.qianbros.com`

本项目已经创建并推送了以下迁移：

- `supabase/migrations/20260505000100_game_auth_leaderboard.sql`
- `supabase/migrations/20260505002000_tighten_game_run_visibility.sql`

### 本地验证

已验证：

- `node --check web_mvp/main.js`
- `leaderboard` 视图可用 public key 匿名读取
- 未登录用户不能写入 `game_runs`
- 首页可在 Chrome headless 中渲染游戏本体

还需要用真实账号验证：

1. 打开 `http://127.0.0.1:8000`。
2. 点击「账号」，用邮箱注册/登录。
3. 完成一局游戏。
4. 确认游戏结束后自动保存，并在「胜利榜」出现记录。

### OAuth 登录

邮箱登录不需要额外 OAuth 配置。Google 登录已在 Supabase Authentication Providers 中启用。Apple 登录需要在 Supabase Authentication Providers 里开启，并填入 Apple Developer 的 OAuth 信息。

OAuth secret、Supabase PAT、数据库密码等敏感值保存在仓库根目录的 `.secrets/supabase-google.env`，该目录已被 `.gitignore` 忽略，不要提交到 GitHub 或部署到 Netlify 前端。

### 部署

当前目录是静态站点，可以部署到 Vercel、Netlify 或 Cloudflare Pages。部署时要包含：

- `index.html`
- `main.js`
- `styles.css`
- `config.js`

不要把 Supabase service role key 放进前端。这里只能使用 public anon key。
