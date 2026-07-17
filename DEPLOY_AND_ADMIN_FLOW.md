# 杭州浮生记：发布与后台管理统一流程（单文档）

## 一、发布流程（你的目标：本地改完 -> Git 最新 -> 域名自动最新）

当前已配置完成：
- 域名：`https://hz.qianbros.com`
- GitHub Pages：公开主入口
- EdgeOne：国内访问副本（当前连接私有镜像仓库，等待绑定长期自定义域名）
- GitHub 仓库：`Learychin/hangzhou-fushengji-public`
- EdgeOne 镜像仓库：`Learychin/hangzhou-fushengji-public-edgeone`
- 自动部署分支：`main`
- 发布目录：`web_mvp`
- 构建命令：无（静态站点）

### 日常发布步骤（固定）
1. 本地开发并测试
2. 提交代码
3. 推送公开仓库的 `main`

```bash
git add .
git commit -m "feat: xxx"
git push origin main
```

4. 将 `web_mvp` 和 `edgeone.json` 同步到 EdgeOne 镜像仓库的 `main`
5. 等待 GitHub Pages 与 EdgeOne 自动部署完成
6. 打开 `https://hz.qianbros.com` 验证

### 快速排查（若线上没更新）
1. 看当前分支是否真在 `main`
2. 看 `git log` 是否有你刚提交
3. 去 GitHub Actions 和 EdgeOne 部署记录看最近一次是否成功
4. 强制刷新浏览器（`Cmd+Shift+R`）

---

## 二、后台权限策略（确保只有你能看）

现在是双层保护：
1. 前端 Gate：未通过管理员验证，不展示后台内容。
2. 后端 RLS/RPC：`admin_*` 函数会校验 `is_admin()`，非管理员拿不到数据。

管理员邮箱白名单在 SQL 中控制（当前为 `qiankeyl@gmail.com`）。

---

## 三、排行榜规则（已改）

新规则：同一玩家的多局成绩都可以上榜。  
不再是“每人只保留最高分一条”。

实现方式：`leaderboard` 视图按每局记录排序（分数降序、时间升序），不再 `distinct on user_id`。

---

## 四、后台事件流交互（已改）

新交互：
1. 先在“对局”列表点击某一局的“查看事件”
2. 右下“事件流”只展示该局对应的事件

这样不会把所有人的事件混在一起，分析更清晰。

---

## 五、你现在可以怎么用

1. 正常开发：改本地 -> `push main` -> 自动上线域名
2. 复盘某局：后台点该局 -> 看专属事件流
3. 看榜单：同一玩家多局都能进榜，只要分数够高

## 六、朋友盲测后台

- 后台地址：`https://hz.qianbros.com/admin.html`
- 使用管理员账号在游戏页登录后进入后台。
- “朋友盲测控制台”显示五档各自的玩家数、反馈数和入围门槛。
- “暂停全部盲测”会让之后的新对局回到默认规则；已开始的对局仍使用开局时锁定的档位。
- “恢复五档等权”会同时启用五档、统一权重为 100，并把合作内容保持为草稿。
- 第一轮目标是五档各 5 位完整玩家，不用让少数玩家反复补足人数。
