# SSHX - fnOS 原生 SSH 终端客户端

> 多标签 SSH 终端，支持连接保存、密码加密、导入导出。

运行在 fnOS 上的轻量 SSH 终端客户端，基于 fnOS 原生 fpk 架构。

<img width="1097" height="730" alt="image" src="https://github.com/user-attachments/assets/22ba17b5-05bd-436a-a0e2-eb4d891ba915" />

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
