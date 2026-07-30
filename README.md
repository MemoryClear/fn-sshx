# SSHX - fnOS 原生 SSH 终端客户端

> 多标签 SSH 终端，支持连接保存、密码加密、导入导出。

运行在 fnOS 上的轻量 SSH 终端客户端，基于 fnOS 原生 fpk 架构。

## 功能

- 多标签 SSH 终端
- 连接保存与分组管理
- 访问密码保护
- 密码加密存储（AES-256-GCM）
- 连接导入导出（加密备份）
- 移动端基础适配

## 安装

从 [Releases](https://github.com/MemoryClear/fn-sshx/releases) 下载 `sshx.fpk`，在 fnOS 应用中心安装。

## 使用

启动后首次进入需要设置访问密码，之后在侧边栏添加 SSH 连接即可。

## 开发

修改源码后重新打包：

```powershell
./build_single.ps1      # 内联前端 → index.html
fnpack build -d .       # 打包 → sshx.fpk
```

CI 推送到 master 后会自动构建并发布 Release。

## 技术栈

- 后端：Node.js + ssh2 + ws
- 前端：xterm.js + 原生 JS
- 打包：fnpack

## License

MIT

## 效果图
<img width="1098" height="638" alt="2" src="https://github.com/user-attachments/assets/5986c2ee-3994-4543-b641-8b58ad40aff9" />

<img width="1097" height="633" alt="4" src="https://github.com/user-attachments/assets/3a0fa689-0dc8-4342-b142-6b48dd2a8984" />

<img width="1098" height="637" alt="3" src="https://github.com/user-attachments/assets/7c474f52-1bc9-4209-a567-c313e1561839" />

