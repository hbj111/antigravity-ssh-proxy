<div align="center">
<img src="https://raw.githubusercontent.com/dinobot22/antigravity-ssh-proxy/main/ATP.jpg" width="128" />

# Antigravity SSH Proxy (ATP)

**简体中文** · [English](README.en.md)

[![Version](https://img.shields.io/open-vsx/v/dinobot22/antigravity-ssh-proxy)](https://open-vsx.org/extension/dinobot22/antigravity-ssh-proxy)
[![GitHub stars](https://img.shields.io/github/stars/dinobot22/antigravity-ssh-proxy)](https://github.com/dinobot22/antigravity-ssh-proxy)
[![GitHub issues](https://img.shields.io/github/issues/dinobot22/antigravity-ssh-proxy)](https://github.com/dinobot22/antigravity-ssh-proxy/issues)
[![License](https://img.shields.io/github/license/dinobot22/antigravity-ssh-proxy)](https://github.com/dinobot22/antigravity-ssh-proxy/blob/main/LICENSE)

</div>
这是一个专为 **Antigravity** 设计的扩展（[Open VSX 地址](https://open-vsx.org/extension/dinobot22/antigravity-ssh-proxy) ， 用于将 SSH 远程服务器的网络流量通过反向隧道路由至本地代理, 实现远程服务器复用本地的代理能力，从而恢复SSH远程服务器上的 AI 功能。

> ✨ **无需 root 权限** - 所有操作均在用户空间完成，安全便捷！

> **注意:** 支持 **Linux 远程服务器 (x86_64 / amd64 / ARM64)**。ARM64 架构（如 RK3588）已在 v0.0.16 中获得正式支持。

> 本项目基于 [wang-muhan/antigravity-interface](https://github.com/wang-muhan/antigravity-interface) 进行二次开发，感谢原作者的出色工作！

---

## ⚠️ 重要：需要双端安装

此插件必须同时安装在 **本地** 和 **远程服务器** 上：

| 位置 | 职责 |
|------|------|
| **本地** | 管理 SSH 端口转发配置 (`~/.ssh/config.antigravity`) |
| **远程** | 配置 Language Server 代理包装器 (mgraftcp) |

---

## 功能特性

- **自动代理配置**：自动部署 `mgraftcp` 并配置代理。
- **SSH 反向隧道**：通过 SSH 端口转发将流量路由到本地代理。
- **进程重定向**：自动拦截并重定向语言服务器进程。
- **DNS 污染防护**：集成 FakeDNS 功能，有效解决 DNS 污染导致的连接问题，确保稳定连接。

## 快速开始

### 前置条件

在开始之前，请确保满足以下条件：

- ✅ 本地代理软件（如 Clash、V2Ray）已启动并正常运行
- ✅ 本地 Antigravity 的 AI 功能可以正常使用（这表明您的网络环境已正确配置）

---

### 配置步骤

**Step 1 — 本地安装与配置**

1. 打开一个本地的 Antigravity项目并在扩展中搜索并安装 **Antigravity SSH Proxy** 插件(目前安装量比较小,可能需要按名称排序才能找到)
2. 安装成功后点击左下角 **ATP 面板**，配置 `localProxyPort` 为您本地代理端口（如 `7890`）
3. 检查面板状态，确认本地配置无异常. 

**Step 2 — 远程安装**

1. 使用 Antigravity SSH 连接到远程 Linux 服务器. PS: 步骤一启动的本地Antigravity窗口,尽量不要关闭
2. 在插件视图的 **"SSH: [服务器名]"** 分类下，再次安装本插件

**Step 3 — 激活并验证**

1. 按照提示执行 **Reload Window** 重启窗口. PS: 由于远程的需要对language server进行wrapper, 插件有的时候会提示您**多次**重启远程窗口,**按提示重启**. 本地的Antigravity窗口一般不需要重启)
2. 打开右下角 **ATP 面板**，运行 **连接诊断** 检查代理状态。如果是 RK3588 等 ARM64 设备，重点关注 **Language Server Wrapper** 检查是否报“架构不匹配”警告。
3. 显示正常后，远程 AI 功能即可使用 🎉
   
**Step 4 — 简单重试**

如果发现功能不能正常使用时:
1. 关闭所有的(本地+远程)Antigravity窗口
2. 先打开本地的Antigravity窗口,等待本地插件启动完成(左下角ATP变绿),
3. 再点击左边的SSH链接远程服务器进行重试, 连接远程终端时一般有两个选项
> 1. 在当前窗口链接远程服务(connect SSH host in current window)
> 2. 打开新窗口链接远程服务(connect SSH host in new window) **<-- 选择这个**

进行重试,查看是否可行
   
**当系统提示需要重启窗口时，请重启以确保功能正常使用**

---


### 故障排查

如果配置+重试后仍无法正常使用，提交Bug日志时请附带一下远程链接服务器的日志信息：
> 1.  ATP页面中运行诊断, 复制诊断结果
> 2.  Antigravity的Output 面板内容中的
>    
> | 日志频道 | 查看路径 |
> |---------|---------| 
> | `Antigravity` | Output 面板 → Antigravity |
> | `Antigravity SSH Proxy` | Output 面板 → Antigravity SSH Proxy |

> 4. 架构兼容性说明 (针对 ARM64)
> 如果你的系统是 `aarch64` (64位) 但 `ps -aux` 显示 `language_server_linux_arm` (32位)，FakeDNS 功能将无法工作，请尝试更换 64 位版本的 Antigravity Server。

> 4. 一些额外的系统信息
> ```bash
>    uname -a                          # 内核版本
>    uname -m                          # 架构 (x86_64/aarch64)
>    ps -aux |grep language_server     # 查看实际启动的language_server
>    cat /proc/sys/kernel/yama/ptrace_scope  # Ptrace 权限信息
>    ls -la /.dockerenv                # 是否在 Docker 中
>    lscpu | grep -i aes               # 查看cpu情况
>    ps -aux | grep language_server
> ```

## 扩展设置

| 设置 | 说明 |
|------|------|
| `enableLocalForwarding` | 启用 SSH 反向隧道转发。 |
| `localProxyPort` | 本地计算机上的代理端口。 |
| `remoteProxyHost` | 远程服务器上的代理主机地址。 |
| `remoteProxyPort` | 远程服务器上的代理端口。 |
| `showStatusOnStartup` | 连接远程服务器时显示状态通知。 |

## 打包与安装

### 1. 编译并打包为 .vsix
在项目根目录下依次运行以下命令：
```bash
npm install        # 安装依赖 (仅首次)
npm run vsce:package # 编译代码并生成 .vsix 文件
```
运行完成后，会在根目录下生成一个 `antigravity-ssh-proxy-0.0.16.vsix` 文件。

### 2. 部署到 Antigravity

由于 Antigravity 分为本地和远程两个环境，请务必按照以下顺序安装：

**第一步：本地安装**
1. 在 Antigravity 中打开扩展视图 (`Ctrl+Shift+X`)。
2. 点击右上角菜单 `...` -> `Install from VSIX...`。
3. 选择刚才生成的 `.vsix` 文件安装。

**第二步：远程安装 (关键)**
1. 使用 SSH 连接到你的远程服务器（如 RK3588）。
2. 在连接后的窗口中，再次打开扩展视图。
3. 找到 **"Antigravity SSH Proxy"**，你会看到一个 **"Install in SSH: <host>"** 的蓝色按钮。
4. 点击该按钮，安装完成后按照提示 **Reload Window**。

---

## 卸载说明

## 环境要求

- 远程服务器的 SSH 访问权限。
- Linux 远程服务器（支持 x86_64/amd64，ARM64 为实验性支持，需 v0.0.15+）。
- 本地运行的代理软件（如 Clash、V2Ray）。

## 致谢

特别感谢以下项目：

- [graftcp](https://github.com/hmgle/graftcp): 提供了核心代理功能。
- [antigravity-interface](https://github.com/wang-muhan/antigravity-interface): 提供了最初的插件实现。

## 常见问题 (FAQ)

### RK3588 / ARM64 平台上出现 "Authentication Required"
如果您在 RK3588 等 ARM64 设备上看到 Agent 窗口显示 "Authentication Required"，通常是由于 **32位与64位架构不匹配** 导致的。

**原因**：
您可能安装了 32 位的 Antigravity Server，而该插件提供的 DNS 劫持库 (`libdnsredir`) 是 64 位的，无法加载到 32 位进程中，导致代理功能失效。

**解决方法**：
1. 在远程 VS Code 的扩展列表中，卸载 **Antigravity** 核心扩展。
2. 在远程终端执行：`rm -rf ~/.antigravity-server` 清理残留环境。
3. 退出并重新连接远程服务器，确保通过 "Install in SSH" 重新安装 **Linux-ARM64** 架构的版本。
4. 重新运行 `Antigravity SSH Proxy: Setup Remote Environment`。
