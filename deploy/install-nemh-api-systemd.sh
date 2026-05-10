#!/usr/bin/env bash
# 在服务器上、于仓库根目录执行：sudo bash deploy/install-nemh-api-systemd.sh
# 可选第一个参数为「仓库根目录」绝对路径，默认与 nemh-api.service 内 WorkingDirectory 一致的上级

set -euo pipefail

REPO_ROOT="${1:-/home/ubuntu/var/www/nemh-app/NEMH}"
SERVICE_NAME="nemh-api"
LOG_DIR="/var/log/nemh-api"
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

mkdir -p "$LOG_DIR"
# 与单元文件 [Service] User 一致；若你改成别的用户，请同步修改下面 chown
chown ubuntu:ubuntu "$LOG_DIR"
chmod 755 "$LOG_DIR"

# 将 WorkingDirectory 写成当前机器上的 server 路径
SERVER_DIR="${REPO_ROOT}/server"
sed "s|^WorkingDirectory=.*|WorkingDirectory=${SERVER_DIR}|" "$UNIT_SRC" >"$UNIT_DST"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "已安装并启动 ${SERVICE_NAME}。"
echo "  状态: systemctl status ${SERVICE_NAME}"
echo "  应用日志: tail -f ${LOG_DIR}/out.log   /   tail -f ${LOG_DIR}/err.log"
echo "  服务日志: journalctl -u ${SERVICE_NAME} -f"
