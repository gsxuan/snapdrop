#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置选项
const config = {
  serverPort: 3001,
  pidFile: path.join(__dirname, '.server.pid'),
  serverPath: path.join(__dirname, 'server/index.js')
};

// 检查服务器是否正在运行
function isServerRunning() {
  if (!fs.existsSync(config.pidFile)) {
    return false;
  }

  const pid = fs.readFileSync(config.pidFile, 'utf8').trim();
  try {
    // 0信号只检查进程是否存在，不发送任何信号
    process.kill(parseInt(pid, 10), 0);
    return true;
  } catch (e) {
    // 进程不存在
    fs.unlinkSync(config.pidFile);
    return false;
  }
}

// 启动服务器
function startServer() {
  if (isServerRunning()) {
    console.log(`服务器已经在运行，端口: ${config.serverPort}`);
    return;
  }

  console.log(`启动服务器，端口: ${config.serverPort}`);
  
  const server = spawn('node', [config.serverPath], {
    env: { ...process.env, PORT: config.serverPort },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // 保存PID
  fs.writeFileSync(config.pidFile, server.pid.toString());

  // 输出服务器日志
  server.stdout.on('data', (data) => {
    console.log(`[服务器]: ${data}`);
  });

  server.stderr.on('data', (data) => {
    console.error(`[服务器错误]: ${data}`);
  });

  server.on('close', (code) => {
    if (code !== 0) {
      console.log(`服务器进程异常退出，代码: ${code}`);
    }
  });

  // 分离进程，这样即使脚本退出服务器也会继续运行
  server.unref();
  
  console.log(`服务器已启动，PID: ${server.pid}`);
  console.log('你可以使用浏览器访问: http://localhost:3001');
}

// 停止服务器
function stopServer() {
  if (!isServerRunning()) {
    console.log('服务器未运行');
    return;
  }

  const pid = fs.readFileSync(config.pidFile, 'utf8').trim();
  console.log(`停止服务器，PID: ${pid}`);

  try {
    // 发送SIGTERM信号给进程
    process.kill(parseInt(pid, 10), 'SIGTERM');
    fs.unlinkSync(config.pidFile);
    console.log('服务器已停止');
  } catch (e) {
    console.error('停止服务器失败:', e.message);
    // 如果无法正常停止，强制删除PID文件
    if (fs.existsSync(config.pidFile)) {
      fs.unlinkSync(config.pidFile);
    }
  }
}

// 重启服务器
function restartServer() {
  stopServer();
  // 短暂延迟确保端口释放
  setTimeout(() => {
    startServer();
  }, 1000);
}

// 显示状态
function showStatus() {
  if (isServerRunning()) {
    const pid = fs.readFileSync(config.pidFile, 'utf8').trim();
    console.log(`服务器正在运行，PID: ${pid}，端口: ${config.serverPort}`);
  } else {
    console.log('服务器未运行');
  }
}

// 显示帮助信息
function showHelp() {
  console.log(`
讯传应用开发脚本

使用方法:
  node dev.js [命令]

命令:
  start   启动服务器
  stop    停止服务器
  restart 重启服务器
  status  显示服务器状态
  help    显示此帮助信息
  
如果不指定命令，将进入交互模式
`);
}

// 交互式命令行界面
function startInteractiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '讯传> '
  });

  console.log('欢迎使用讯传开发脚本 - 输入 "help" 查看可用命令');
  showStatus();
  rl.prompt();

  rl.on('line', (line) => {
    const cmd = line.trim();
    
    switch (cmd) {
      case 'start':
        startServer();
        break;
      case 'stop':
        stopServer();
        break;
      case 'restart':
        restartServer();
        break;
      case 'status':
        showStatus();
        break;
      case 'help':
        showHelp();
        break;
      case 'exit':
      case 'quit':
        rl.close();
        return;
      case '':
        // 忽略空行
        break;
      default:
        console.log(`未知命令: ${cmd}，输入 "help" 查看可用命令`);
    }
    
    rl.prompt();
  }).on('close', () => {
    console.log('谢谢使用讯传开发脚本，再见！');
    process.exit(0);
  });
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    // 无命令进入交互模式
    startInteractiveMode();
    return;
  }

  switch (command) {
    case 'start':
      startServer();
      break;
    case 'stop':
      stopServer();
      break;
    case 'restart':
      restartServer();
      break;
    case 'status':
      showStatus();
      break;
    case 'help':
      showHelp();
      break;
    default:
      console.log(`未知命令: ${command}`);
      showHelp();
  }
}

// 运行主函数
main(); 