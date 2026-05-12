#!/usr/bin/env bash
# 在服务器上、于仓库根目录执行：sudo bash deploy/install-nemh-api-systemd.sh [REPO_ROOT]

set -euo pipefail

REPO_ROOT="${1:-/home/ubuntu/var/www/nemh-app/NEMH}"
SERVICE_NAME="nemh-api"
UNIT_SRC="${REPO_ROOT}/deploy/nemh-api.service"
UNIT_DST="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 执行: sudo bash deploy/install-nemh-api-systemd.sh" >&2
  exit 1
fi

if [[ ! -f "$UNIT_SRC" ]]; then
  echo "找不到单元文件: $UNIT_SRC" >&2
  exit 1
fi

mkdir -p "${REPO_ROOT}/logs"
chown ubuntu:ubuntu "${REPO_ROOT}/logs"
chmod 755 "${REPO_ROOT}/logs"
touch "${REPO_ROOT}/logs/api.log" "${REPO_ROOT}/logs/service.log"
chown ubuntu:ubuntu "${REPO_ROOT}/logs/api.log" "${REPO_ROOT}/logs/service.log"

# 将 __REPO_ROOT__ 替换为绝对路径（勿含 & 或 \ 等特殊 sed 字符）
sed "s|__REPO_ROOT__|${REPO_ROOT}|g" "$UNIT_SRC" >"$UNIT_DST"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "已安装并启动 ${SERVICE_NAME}。"
echo "  状态: systemctl status ${SERVICE_NAME}"
echo "  应用日志: tail -f ${REPO_ROOT}/logs/api.log"
echo "  服务启停: tail -f ${REPO_ROOT}/logs/service.log"
echo "  systemd: journalctl -u ${SERVICE_NAME} -f"
