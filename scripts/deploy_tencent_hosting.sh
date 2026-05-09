#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/deploy_tencent_hosting.sh [ENV_ID]
#
# Example:
#   ./scripts/deploy_tencent_hosting.sh hangshoufushengji-d5dnf0f65236ad
#
# Notes:
# - Requires CloudBase CLI: tcb
# - Requires prior login: tcb login
# - Uploads local web_mvp directory to CloudBase static hosting root

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v tcb >/dev/null 2>&1; then
  echo "❌ 未检测到 tcb CLI，请先安装 CloudBase CLI。"
  exit 1
fi

ENV_ID="${1:-}"
if [[ -z "$ENV_ID" ]]; then
  if [[ -f "wechat_minigame/cloudbaserc.json" ]]; then
    ENV_ID="$(sed -n 's/.*"envId":[[:space:]]*"\([^"]*\)".*/\1/p' wechat_minigame/cloudbaserc.json | head -n1)"
  fi
fi

if [[ -z "$ENV_ID" ]]; then
  echo "❌ 无法自动识别 envId，请手动传入："
  echo "   ./scripts/deploy_tencent_hosting.sh <ENV_ID>"
  exit 1
fi

echo "🔐 检查登录态..."
if ! tcb env list --json >/dev/null 2>&1; then
  echo "❌ 当前未登录 CloudBase，请先执行：tcb login"
  exit 1
fi

echo "🚀 开始部署 web_mvp -> CloudBase Hosting（env: $ENV_ID）"
tcb hosting deploy web_mvp / -e "$ENV_ID"

echo ""
echo "✅ 部署完成。下一步："
echo "1) 在腾讯云 CloudBase 控制台绑定自定义域名（hz.qianbros.com）"
echo "2) 开启 HTTPS 并签发证书"
echo "3) 将 DNS CNAME 从 learychin.github.io 切到 CloudBase 提供的 CNAME"

