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

### 忘记访问密码

访问密码（哈希）与连接密码的加密密钥都存在应用目录的 `settings.json` 中。
忘记密码时，可在 fnOS 终端执行包内自带的重置脚本：

```bash
# 只清除面板密码：连接列表、已保存的 SSH 密码全部保留
sudo bash /vol1/@appcenter/sshx/cmd/reset_pass

# 只看当前状态，不改文件
sudo bash /vol1/@appcenter/sshx/cmd/reset_pass --show

# 预览改动
sudo bash /vol1/@appcenter/sshx/cmd/reset_pass --dry-run

# 连加密密钥一起清除（已保存的 SSH 密码会一并失效）
sudo bash /vol1/@appcenter/sshx/cmd/reset_pass --purge-key
```

执行后刷新页面即可重新设置密码，**无需重启应用**；改动前会自动备份为
`settings.json.bak.<时间戳>`（保留最近 5 份）。

脚本只删除 `appPasswordHash`，保留 `encryptionKey`，所以重置后已保存的
SSH 连接密码依然可以正常解密——重新设置面板密码时密钥也会沿用。

> 应用目录不一定在 `vol1`，按实际安装卷调整路径（如 `/vol2/@appcenter/sshx`）。

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

