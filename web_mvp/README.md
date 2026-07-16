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

## 字体

游戏界面统一使用自托管的 MiSans WOFF2 使用字符切片，文件位于 `fonts/`。字体来源与版权说明见 `fonts/NOTICE.txt`。

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
- `supabase/migrations/20260715160000_gameplay_experiments_and_native_ads.sql`
- `supabase/migrations/20260716150000_activate_friend_blind_test.sql`

后两份迁移包含五档隐藏玩法、匿名反馈、每局档位归因和后台节奏汇总，并以等权方式启动第一轮朋友盲测。测试身份只保存在玩家设备本地；一局开始后档位锁定，中途刷新不会改变数值配置。后台可直接查看完成率、自然再来率、平均用时、主操作次数、10 天回正率与盈利卖出率。

### 城市内容配置

后台的“城市 JSON 配置”会直接驱动下一局的城市内容。当前杭州未填写覆盖项时继续使用内置内容，因此不会改变现有界面。新增城市可使用：

```json
{
  "content_schema": "city-content-v1",
  "short_title": "城市浮生",
  "full_title": "城市浮生记",
  "start_title": "城市开局",
  "scene_key": "city-v1",
  "locations": [
    { "name": "地点一", "district": "central" }
  ],
  "district_labels": { "central": "中心区" },
  "product_overrides": [
    { "id": 0, "name": "城市特产", "base": 12, "span": 48 }
  ],
  "news_pool": []
}
```

`locations` 需保持 12 项，以沿用当前移动端矩阵；`product_overrides` 通过现有商品 `id` 替换名称和价格参数。

### 合作内容接口

后台可配置 `news`、`product`、`location` 三种当前有效位置，并按商品或地点 ID 定向。所有合作内容统一标记为 `合作内容`：

- `product`：玩家主动选中目标商品后，在底部交易信息格显示一行入口。
- `location`：玩家真实换到目标地点后显示一行入口。
- `news`：真实市场新闻的弹窗队列结束后再展示。
- 每日频控只在实际曝光时计数；曝光、点击、关闭均写入事件记录。
- `economy_effect` 当前只保存、不执行，合作内容不能直接改变游戏经济。

本地可用 `qa_campaigns=1` 加载三条固定测试内容。该参数只在 `localhost` 与 `127.0.0.1` 生效。完整手机路径验证：

```bash
MOBILE_CAMPAIGN_QA=1 MOBILE_WIDTH=390 MOBILE_HEIGHT=844 node scripts/smoke_mobile_cdp.mjs
```

### 本地验证

已验证：

- `node --check web_mvp/main.js`
- `node scripts/simulate_core_30turns.mjs`
- `node scripts/simulate_thumb_flow_30days.mjs`
- `node scripts/check_mobile_manifest.mjs`
- `node scripts/smoke_mobile_grid.mjs`（验证 360/390/430 三种手机视口、矩阵比例、零间隙、买卖切换、账号入口和 PWA 缓存）
- `node scripts/check_gameplay_experiment_contract.mjs`（验证五档源配置、Web 资源、数据库初始配置和反馈开关完全一致）
- `RUNS=3 node scripts/playtest_all_experiments_mobile.mjs`（五档各跑三局，验证 45 天完成、局长、结构化指标和反馈归因）
- `MOBILE_CAMPAIGN_QA=1 MOBILE_WIDTH=390 MOBILE_HEIGHT=844 node scripts/smoke_mobile_cdp.mjs`（验证三类合作内容、频控、事件记录和经济隔离）
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
