# 杭州浮生记版本与多端同步工作流

本项目当前采用单仓管理（Web + 微信小程序 + 云端脚本），目标是保证线下开发与线上发布保持同一事实来源。

## 1. 分支策略

- `master`（或后续改名 `main`）：线上稳定版本，只接受通过 PR 的改动。
- `develop`：日常集成分支，功能完成后先合并到这里。
- `feature/<name>`：单功能分支，例如 `feature/hz-event-pack-01`。

## 2. 提交流程

1. 从 `develop` 切分支开发。
2. 提 PR 到 `develop`，按模板填写“变更摘要/发布说明草稿”。
3. 添加标签：
   - 语义版本：`semver:major | semver:minor | semver:patch`
   - 改动领域：`area:gameplay | area:ui | area:backend ...`
4. 合并后由 Release Drafter 自动累计版本说明。
5. 需要发布时，从 `develop` 合并到 `master/main`，创建正式 Release。

## 3. 自动版本说明

- 使用 `.github/release-drafter.yml` 自动汇总 PR 变更。
- 版本说明将按标签分类，形成可读的更新日志。
- 团队只需要在 PR 写清楚“改了什么”，发布时自动整合。

## 4. Web / 小程序同步建议

- 玩法与数值逻辑尽量放在共享模块（后续可抽 `packages/core`）。
- 在同步完成之前，先执行“规则双检”：
  - 同一版本号下，Web 与小程序的关键参数必须一致。
  - 每次发布前跑一份对照 checklist（商品池、事件概率、债务规则、健康/名声阈值）。

## 5. 版本命名建议

- 外部版本号：`vX.Y.Z`（例如 `v0.9.0`）
- 内部代号：保留你们现有格式，例如 `HZFSJ-MARKET-ALPHA-8x10`
- 推荐在每次新局日志首条写入：`版本号 + 内部代号`

## 6. GitHub CLI（gh）常用命令

```bash
# 首次安装（macOS）
brew install gh
gh auth login

# 日常开发
git checkout develop
git pull
git checkout -b feature/your-change
git add .
git commit -m "feat: your change"
git push -u origin feature/your-change
gh pr create --base develop --head feature/your-change --fill

# 发布
git checkout master
git pull
git merge --no-ff develop
git push
gh release create v0.9.0 --generate-notes
```
