#!/bin/bash

# 讯传开发脚本 - Shell版本
# 用于快速启动、停止和重启应用服务

# 配置选项
SERVER_PORT=3001
PID_FILE=".server.pid"
SERVER_PATH="server/index.js"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # 无颜色

# 检查服务器是否正在运行
is_server_running() {
  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  
  pid=$(cat "$PID_FILE")
  if ps -p "$pid" > /dev/null; then
    return 0
  else
    rm -f "$PID_FILE"
    return 1
  fi
}

# 启动服务器
start_server() {
  if is_server_running; then
    echo -e "${YELLOW}服务器已经在运行，端口: $SERVER_PORT${NC}"
    return
  fi
  
  echo -e "${GREEN}启动服务器，端口: $SERVER_PORT${NC}"
  PORT=$SERVER_PORT node "$SERVER_PATH" > server.log 2>&1 &
  pid=$!
  echo $pid > "$PID_FILE"
  
  echo -e "${GREEN}服务器已启动，PID: $pid${NC}"
  echo -e "${BLUE}你可以使用浏览器访问: http://localhost:$SERVER_PORT${NC}"
  echo -e "${BLUE}日志保存在 server.log${NC}"
}

# 停止服务器
stop_server() {
  if ! is_server_running; then
    echo -e "${YELLOW}服务器未运行${NC}"
    return
  fi
  
  pid=$(cat "$PID_FILE")
  echo -e "${YELLOW}停止服务器，PID: $pid${NC}"
  
  kill $pid
  rm -f "$PID_FILE"
  echo -e "${GREEN}服务器已停止${NC}"
}

# 重启服务器
restart_server() {
  stop_server
  # 延迟1秒确保端口释放
  sleep 1
  start_server
}

# 显示服务器状态
show_status() {
  if is_server_running; then
    pid=$(cat "$PID_FILE")
    echo -e "${GREEN}服务器正在运行，PID: $pid，端口: $SERVER_PORT${NC}"
  else
    echo -e "${YELLOW}服务器未运行${NC}"
  fi
}

# 查看日志
view_logs() {
  if [ -f "server.log" ]; then
    tail -f server.log
  else
    echo -e "${RED}日志文件不存在${NC}"
  fi
}

# 显示帮助信息
show_help() {
  echo -e "${BLUE}讯传应用开发脚本${NC}"
  echo
  echo "使用方法:"
  echo "  ./dev.sh [命令]"
  echo
  echo "命令:"
  echo "  start   启动服务器"
  echo "  stop    停止服务器"
  echo "  restart 重启服务器"
  echo "  status  显示服务器状态"
  echo "  logs    查看服务器日志"
  echo "  help    显示此帮助信息"
  echo
  echo "如果不指定命令，将进入交互模式"
}

# 交互式模式
interactive_mode() {
  echo -e "${BLUE}欢迎使用讯传开发脚本 - Shell版本${NC}"
  echo -e "${BLUE}输入 'help' 查看可用命令，输入 'exit' 退出${NC}"
  show_status
  
  while true; do
    echo -ne "${GREEN}讯传> ${NC}"
    read -r cmd
    
    case "$cmd" in
      start)
        start_server
        ;;
      stop)
        stop_server
        ;;
      restart)
        restart_server
        ;;
      status)
        show_status
        ;;
      logs)
        view_logs
        ;;
      help)
        show_help
        ;;
      exit|quit)
        echo "谢谢使用讯传开发脚本，再见！"
        exit 0
        ;;
      "")
        # 忽略空行
        ;;
      *)
        echo -e "${RED}未知命令: $cmd${NC}"
        echo "输入 'help' 查看可用命令"
        ;;
    esac
  done
}

# 主函数
main() {
  if [ $# -eq 0 ]; then
    interactive_mode
    exit 0
  fi
  
  case "$1" in
    start)
      start_server
      ;;
    stop)
      stop_server
      ;;
    restart)
      restart_server
      ;;
    status)
      show_status
      ;;
    logs)
      view_logs
      ;;
    help)
      show_help
      ;;
    *)
      echo -e "${RED}未知命令: $1${NC}"
      show_help
      exit 1
      ;;
  esac
}

# 执行主函数
main "$@" 