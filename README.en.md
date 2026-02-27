<div align="center">
<img src="https://raw.githubusercontent.com/dinobot22/antigravity-ssh-proxy/main/ATP.jpg" width="128" />

# Antigravity SSH Proxy (ATP)

**English** · [简体中文](README.md)

[![Version](https://img.shields.io/open-vsx/v/dinobot22/antigravity-ssh-proxy)](https://open-vsx.org/extension/dinobot22/antigravity-ssh-proxy)
[![GitHub stars](https://img.shields.io/github/stars/dinobot22/antigravity-ssh-proxy)](https://github.com/dinobot22/antigravity-ssh-proxy)
[![GitHub issues](https://img.shields.io/github/issues/dinobot22/antigravity-ssh-proxy)](https://github.com/dinobot22/antigravity-ssh-proxy/issues)
[![License](https://img.shields.io/github/license/dinobot22/antigravity-ssh-proxy)](https://github.com/dinobot22/antigravity-ssh-proxy/blob/main/LICENSE)

</div>

This is an extension for **Antigravity** ([Open VSX Link](https://open-vsx.org/extension/dinobot22/antigravity-ssh-proxy)) designed to simplify SSH remote proxy configuration. ATP bypasses server firewalls by securely routing remote traffic through local or designated gateways.

> ✨ **No Root Permission Required** - All operations run in user space for security and convenience!

> **Note:** Supports **Linux remote servers (x86_64 / amd64)**. ARM64 architecture is **experimentally supported** (requires v0.0.15+).

> This project is a fork of [wang-muhan/antigravity-interface](https://github.com/wang-muhan/antigravity-interface). Thanks to the original author for the excellent work!

---

## ⚠️ Important: Dual Installation Required

This extension must be installed on **BOTH** your local machine and remote server:

| Location | Role |
|----------|------|
| **Local** | Manages SSH port forwarding (`~/.ssh/config.antigravity`) |
| **Remote** | Configures Language Server proxy wrapper (mgraftcp) |

---

## Features

- **Automated Proxy Setup**: Deploys `mgraftcp` and configures proxies automatically.
- **SSH Reverse Tunnel**: Routes traffic through your local proxy via SSH port forwarding.
- **Process Redirection**: Automatically intercepts and redirects language server processes.
- **DNS Pollution Prevention**: Integrated FakeDNS to protect against DNS pollution, ensuring stable connections to Google APIs.

## Quick Start

### Prerequisites

Before you begin, ensure the following conditions are met:

- ✅ Your local proxy software (e.g., Clash, V2Ray) is running and properly configured
- ✅ AI features work correctly in your local Antigravity (this confirms your network environment is set up correctly)

---

### Setup Steps

**Step 1 — Local Installation & Configuration**

1. Search and install **Antigravity SSH Proxy** in your local Antigravity
2. Click the **ATP Panel** in the bottom-left corner, configure `localProxyPort` to match your local proxy port (e.g., `7890`)
3. Check the panel status to confirm local configuration is correct

**Step 2 — Remote Installation**

1. Connect to your remote Linux server using Antigravity SSH
2. Install this extension again under the **"SSH: [server-name]"** category in the Extensions view

**Step 3 — Activate & Verify**

1. Follow the prompt to execute **Reload Window** to restart the window
2. Open the **ATP Panel** in the bottom-right corner, run **Connection Diagnostics** to check proxy status
3. Once everything shows normal, remote AI features are ready to use 🎉

---

### Troubleshooting

If issues persist after configuration, check the following logs:

| Log Channel | Location |
|-------------|----------|
| `Antigravity` | Output Panel → Antigravity |
| `Antigravity SSH Proxy` | Output Panel → Antigravity SSH Proxy |

## Extension Settings

| Setting | Description |
|---------|-------------|
| `enableLocalForwarding` | Enable SSH reverse tunnel forwarding. |
| `localProxyPort` | Local proxy port on your computer. |
| `remoteProxyHost` | Proxy host address on the remote server. |
| `remoteProxyPort` | Proxy port on the remote server. |
| `showStatusOnStartup` | Show status notification when connecting to remote server. |

## Uninstall

Before uninstalling, run the **Antigravity SSH Proxy: Rollback Remote Environment** command to restore the original Language Server.

## Requirements

- SSH access to the remote server.
- Linux remote server (supports x86_64/amd64, ARM64 is experimentally supported, requires v0.0.15+).
- A local proxy running on your computer (e.g., Clash, V2Ray).

## Acknowledgements

Special thanks to the following projects:

- [graftcp](https://github.com/hmgle/graftcp): For the core proxy functionality.
- [antigravity-interface](https://github.com/wang-muhan/antigravity-interface): For the original extension implementation.
