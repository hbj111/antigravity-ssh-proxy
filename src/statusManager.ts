import * as vscode from 'vscode';
import * as net from 'net';

export interface ProxyStatus {
    runningLocation: 'local' | 'remote';
    sshConfigEnabled: boolean;
    localProxyPort: number;
    remoteProxyPort: number;
    remoteProxyHost: string;
    localProxyReachable: boolean;
    remoteProxyReachable: boolean;
    lastUpdated: Date;
    languageServerConfigured?: boolean;
}

type StatusUpdateCallback = (status: ProxyStatus) => void;
type ConfigChangeCallback = () => Promise<void>;

const REFRESH_INTERVAL_SEC = 30;

export class StatusManager {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: ProxyStatus;
    private updateCallbacks: StatusUpdateCallback[] = [];
    private refreshInterval: NodeJS.Timeout | undefined;
    private statusPanel: vscode.WebviewPanel | undefined;
    private countdownInterval: NodeJS.Timeout | undefined;
    private secondsUntilRefresh: number = REFRESH_INTERVAL_SEC;
    private onConfigChange: ConfigChangeCallback | undefined;

    constructor(private isLocal: boolean, private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            -100
        );
        this.statusBarItem.command = 'antigravity-ssh-proxy.showStatusPanel';
        this.statusBarItem.name = 'ATP';

        const config = vscode.workspace.getConfiguration('antigravity-ssh-proxy');
        this.currentStatus = {
            runningLocation: isLocal ? 'local' : 'remote',
            sshConfigEnabled: false,
            localProxyPort: config.get<number>('localProxyPort', 7890),
            remoteProxyPort: config.get<number>('remoteProxyPort', 7890),
            remoteProxyHost: config.get<string>('remoteProxyHost', '127.0.0.1'),
            localProxyReachable: false,
            remoteProxyReachable: false,
            lastUpdated: new Date(),
        };

        this.updateStatusBar();
        this.statusBarItem.show();
    }

    /**
     * 设置配置变更回调（用于重新应用 SSH 配置）
     */
    setConfigChangeCallback(callback: ConfigChangeCallback): void {
        this.onConfigChange = callback;
    }

    onStatusUpdate(callback: StatusUpdateCallback): vscode.Disposable {
        this.updateCallbacks.push(callback);
        return new vscode.Disposable(() => {
            const index = this.updateCallbacks.indexOf(callback);
            if (index >= 0) {
                this.updateCallbacks.splice(index, 1);
            }
        });
    }

    startAutoRefresh(): void {
        this.stopAutoRefresh();
        this.secondsUntilRefresh = REFRESH_INTERVAL_SEC;
        
        this.refreshInterval = setInterval(() => {
            this.refreshStatus();
            this.secondsUntilRefresh = REFRESH_INTERVAL_SEC;
        }, REFRESH_INTERVAL_SEC * 1000);

        this.countdownInterval = setInterval(() => {
            this.secondsUntilRefresh = Math.max(0, this.secondsUntilRefresh - 1);
            this.updatePanelCountdown();
        }, 1000);

        this.refreshStatus();
    }

    stopAutoRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = undefined;
        }
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = undefined;
        }
    }

    async refreshStatus(): Promise<void> {
        const config = vscode.workspace.getConfiguration('antigravity-ssh-proxy');
        
        this.currentStatus.localProxyPort = config.get<number>('localProxyPort', 7890);
        this.currentStatus.remoteProxyPort = config.get<number>('remoteProxyPort', 7890);
        this.currentStatus.remoteProxyHost = config.get<string>('remoteProxyHost', '127.0.0.1');

        if (this.isLocal) {
            this.currentStatus.localProxyReachable = await this.checkPort(
                '127.0.0.1',
                this.currentStatus.localProxyPort
            );
        } else {
            this.currentStatus.remoteProxyReachable = await this.checkPort(
                this.currentStatus.remoteProxyHost,
                this.currentStatus.remoteProxyPort
            );
        }

        this.currentStatus.lastUpdated = new Date();
        this.secondsUntilRefresh = REFRESH_INTERVAL_SEC;
        this.updateStatusBar();
        this.updatePanelIfOpen();
        this.notifyCallbacks();
    }

    updateSSHConfigStatus(enabled: boolean, port?: number): void {
        this.currentStatus.sshConfigEnabled = enabled;
        if (port !== undefined) {
            this.currentStatus.remoteProxyPort = port;
        }
        this.currentStatus.lastUpdated = new Date();
        this.updateStatusBar();
        this.updatePanelIfOpen();
        this.notifyCallbacks();
    }

    updateLanguageServerStatus(configured: boolean): void {
        this.currentStatus.languageServerConfigured = configured;
        this.currentStatus.lastUpdated = new Date();
        this.updateStatusBar();
        this.updatePanelIfOpen();
        this.notifyCallbacks();
    }

    getStatus(): ProxyStatus {
        return { ...this.currentStatus };
    }

    showStatusPanel(): void {
        if (this.statusPanel) {
            this.statusPanel.reveal();
            return;
        }

        this.statusPanel = vscode.window.createWebviewPanel(
            'atpStatus',
            'Antigravity SSH Proxy',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.statusPanel.webview.html = this.getPanelHtml();

        this.statusPanel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this.refreshStatus();
                        break;
                    case 'saveConfig':
                        await this.saveConfig(message.config);
                        break;
                    case 'openDiagnostics':
                        vscode.commands.executeCommand('antigravity-ssh-proxy.diagnose');
                        break;
                    case 'openTrafficPanel':
                        vscode.commands.executeCommand('antigravity-ssh-proxy.showTrafficPanel');
                        break;
                    case 'closeRemote':
                        vscode.window.showInformationMessage(
                            'After closing: 1) Open a new local window  2) Connect to remote from there',
                            'Got it'
                        ).then(() => {
                            vscode.commands.executeCommand('workbench.action.remote.close');
                        });
                        break;
                    case 'saveLangPreference':
                        this.context.globalState.update('tipLanguage', message.lang);
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        this.statusPanel.onDidDispose(() => {
            this.statusPanel = undefined;
        });
    }

    /**
     * 保存配置
     */
    private async saveConfig(newConfig: {
        localProxyPort?: number;
        remoteProxyPort?: number;
        remoteProxyHost?: string;
        enableLocalForwarding?: boolean;
    }): Promise<void> {
        const config = vscode.workspace.getConfiguration('antigravity-ssh-proxy');
        
        try {
            if (newConfig.localProxyPort !== undefined) {
                await config.update('localProxyPort', newConfig.localProxyPort, vscode.ConfigurationTarget.Global);
            }
            if (newConfig.remoteProxyPort !== undefined) {
                await config.update('remoteProxyPort', newConfig.remoteProxyPort, vscode.ConfigurationTarget.Global);
            }
            if (newConfig.remoteProxyHost !== undefined) {
                await config.update('remoteProxyHost', newConfig.remoteProxyHost, vscode.ConfigurationTarget.Global);
            }
            if (newConfig.enableLocalForwarding !== undefined) {
                await config.update('enableLocalForwarding', newConfig.enableLocalForwarding, vscode.ConfigurationTarget.Global);
            }

            // 触发配置变更回调
            if (this.onConfigChange) {
                await this.onConfigChange();
            }

            await this.refreshStatus();
            vscode.window.showInformationMessage('Configuration saved');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save config: ${error}`);
        }
    }

    private updatePanelIfOpen(): void {
        if (this.statusPanel) {
            this.statusPanel.webview.html = this.getPanelHtml();
        }
    }

    private updatePanelCountdown(): void {
        if (this.statusPanel) {
            this.statusPanel.webview.postMessage({
                command: 'updateCountdown',
                seconds: this.secondsUntilRefresh
            });
        }
    }

    private updateStatusBar(): void {
        const status = this.currentStatus;
        let tooltip: string;

        if (this.isLocal) {
            if (status.sshConfigEnabled && status.localProxyReachable) {
                this.statusBarItem.color = '#3fb950';
                tooltip = 'Antigravity SSH Proxy (ATP)\n✅ Connected';
            } else if (status.sshConfigEnabled) {
                this.statusBarItem.color = '#d29922';
                tooltip = 'Antigravity SSH Proxy (ATP)\n⚠️ SSH configured, proxy unreachable';
            } else {
                this.statusBarItem.color = '#f85149';
                tooltip = 'Antigravity SSH Proxy (ATP)\n❌ Disconnected';
            }
        } else {
            if (status.remoteProxyReachable) {
                this.statusBarItem.color = '#3fb950';
                tooltip = 'Antigravity SSH Proxy (ATP)\n✅ Proxy OK';
            } else {
                this.statusBarItem.color = '#f85149';
                tooltip = 'Antigravity SSH Proxy (ATP)\n❌ Proxy unreachable';
            }
        }

        this.statusBarItem.text = '$(circle-large-filled) ATP';
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.backgroundColor = undefined;
    }

    private checkPort(host: string, port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
            socket.connect(port, host);
        });
    }

    private notifyCallbacks(): void {
        const status = this.getStatus();
        for (const callback of this.updateCallbacks) {
            callback(status);
        }
    }

    private getPanelHtml(): string {
        const status = this.currentStatus;
        const isLocal = status.runningLocation === 'local';
        const config = vscode.workspace.getConfiguration('antigravity-ssh-proxy');
        const enableForwarding = config.get<boolean>('enableLocalForwarding', true);
        const savedLang = this.context.globalState.get<string>('tipLanguage', 'en');
        
        let statusColor: string;
        let statusText: string;

        if (isLocal) {
            if (status.sshConfigEnabled && status.localProxyReachable) {
                statusColor = '#3fb950';
                statusText = 'Connected';
            } else if (status.sshConfigEnabled) {
                statusColor = '#d29922';
                statusText = 'Partial';
            } else {
                statusColor = '#f85149';
                statusText = 'Disconnected';
            }
        } else {
            statusColor = status.remoteProxyReachable ? '#3fb950' : '#f85149';
            statusText = status.remoteProxyReachable ? 'Connected' : 'Disconnected';
        }

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            font-size: 13px;
        }
        .container { max-width: 420px; margin: 0 auto; }
        
        .header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-editorWidget-border);
        }
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: ${statusColor};
            box-shadow: 0 0 6px ${statusColor}80;
        }
        .title { font-size: 15px; font-weight: 600; }
        .status-badge {
            margin-left: auto;
            font-size: 10px;
            font-weight: 500;
            padding: 3px 8px;
            border-radius: 10px;
            background: ${statusColor}20;
            color: ${statusColor};
            text-transform: uppercase;
        }
        .env-tag {
            font-size: 9px;
            padding: 2px 6px;
            border-radius: 3px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            text-transform: uppercase;
        }
        
        .section {
            margin-bottom: 20px;
        }
        .section-title {
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
        }
        
        .card {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            overflow: hidden;
        }
        
        .row {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid var(--vscode-editorWidget-border);
        }
        .row:last-child { border-bottom: none; }
        .row-label {
            flex: 1;
            color: var(--vscode-descriptionForeground);
        }
        .row-value {
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 12px;
        }
        .row-value.on { color: #3fb950; }
        .row-value.off { color: #f85149; }
        
        .input-row {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-editorWidget-border);
            gap: 8px;
        }
        .input-row:last-child { border-bottom: none; }
        .input-row label {
            flex: 1;
            color: var(--vscode-descriptionForeground);
        }
        .input-row input[type="text"],
        .input-row input[type="number"] {
            width: 120px;
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 12px;
        }
        .input-row input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .toggle {
            position: relative;
            width: 36px;
            height: 20px;
        }
        .input-row .toggle {
            flex: none;
        }
        .toggle input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 10px;
            transition: 0.2s;
        }
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 14px;
            width: 14px;
            left: 2px;
            bottom: 2px;
            background: var(--vscode-descriptionForeground);
            border-radius: 50%;
            transition: 0.2s;
        }
        .toggle input:checked + .toggle-slider {
            background: #3fb950;
            border-color: #3fb950;
        }
        .toggle input:checked + .toggle-slider:before {
            transform: translateX(16px);
            background: white;
        }
        
        .actions {
            display: flex;
            gap: 8px;
            margin-top: 16px;
        }
        .btn {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 8px 12px;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.15s;
        }
        .btn:hover { opacity: 0.9; }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn svg { width: 14px; height: 14px; }
        
        .footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-editorWidget-border);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .countdown-num {
            font-family: 'SF Mono', Monaco, monospace;
            color: var(--vscode-editor-foreground);
        }
        
        /* Alert styles */
        .alert {
            display: flex;
            gap: 12px;
            padding: 14px;
            border-radius: 6px;
            border: 1px solid;
        }
        .alert-warning {
            background: #d299221a;
            border-color: #d29922;
        }
        .alert-icon {
            font-size: 20px;
            flex-shrink: 0;
        }
        .alert-content {
            flex: 1;
        }
        .alert-title {
            font-weight: 600;
            font-size: 13px;
            color: #d29922;
            margin-bottom: 6px;
        }
        .alert-message {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
            margin-bottom: 10px;
        }
        .alert-steps {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 12px;
        }
        .alert-step {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }
        .step-num {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #d29922;
            color: #000;
            font-size: 10px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .btn-warning {
            background: #d29922;
            color: #000;
            font-weight: 600;
        }
        .btn-warning:hover {
            background: #e5a826;
        }
        
        /* Tip card styles */
        .section-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .lang-switch {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .lang-label {
            font-size: 10px;
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
        }
        .toggle-small {
            width: 28px;
            height: 16px;
        }
        .toggle-small .toggle-slider:before {
            height: 10px;
            width: 10px;
            left: 2px;
            bottom: 2px;
        }
        .toggle-small input:checked + .toggle-slider:before {
            transform: translateX(12px);
        }
        .tip-card {
            display: flex;
            gap: 10px;
            padding: 12px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.6;
            color: var(--vscode-descriptionForeground);
        }
        .tip-icon {
            font-size: 16px;
            flex-shrink: 0;
            margin-top: 2px;
        }
        .tip-content strong {
            color: var(--vscode-editor-foreground);
        }
        .tip-content .tip-title {
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            margin-bottom: 8px;
        }
        .tip-content .tip-steps {
            margin: 0;
            padding-left: 0;
            list-style: none;
        }
        .tip-content .tip-step {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 6px;
        }
        .tip-content .tip-step:last-child {
            margin-bottom: 0;
        }
        .tip-content .step-num {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 18px;
            height: 18px;
            border-radius: 50%;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 10px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .tip-content .step-text {
            flex: 1;
        }
        .tip-content .tip-note {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px dashed var(--vscode-editorWidget-border);
            font-size: 11px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="status-dot"></div>
            <span class="title">Antigravity SSH Proxy</span>
            <span class="env-tag">${isLocal ? 'Local' : 'Remote'}</span>
            <span class="status-badge">${statusText}</span>
        </div>
        
        ${!isLocal && !status.remoteProxyReachable ? `
        <div class="section">
            <div class="alert alert-warning">
                <div class="alert-icon">⚠️</div>
                <div class="alert-content">
                    <div class="alert-title">SSH Tunnel Not Established</div>
                    <div class="alert-message">
                        Proxy is unreachable. This usually happens when you connect directly to remote via Antigravity's recent connections.
                    </div>
                    <div class="alert-steps">
                        <div class="alert-step"><span class="step-num">1</span> Close this remote connection</div>
                        <div class="alert-step"><span class="step-num">2</span> Open a new local window first</div>
                        <div class="alert-step"><span class="step-num">3</span> Then connect to remote</div>
                    </div>
                    <button class="btn btn-warning" onclick="closeRemote()">Close Remote Connection</button>
                </div>
            </div>
        </div>
        ` : ''}
        
        <div class="section">
            <div class="section-title">Status</div>
            <div class="card">
                ${isLocal ? `
                <div class="row">
                    <span class="row-label">SSH Forwarding</span>
                    <span class="row-value ${status.sshConfigEnabled ? 'on' : 'off'}">${status.sshConfigEnabled ? 'ON' : 'OFF'}</span>
                </div>
                <div class="row">
                    <span class="row-label">Local Proxy</span>
                    <span class="row-value ${status.localProxyReachable ? 'on' : 'off'}">${status.localProxyReachable ? 'Reachable' : 'Unreachable'}</span>
                </div>
                ` : `
                <div class="row">
                    <span class="row-label">Proxy</span>
                    <span class="row-value ${status.remoteProxyReachable ? 'on' : 'off'}">${status.remoteProxyReachable ? 'Reachable' : 'Unreachable'}</span>
                </div>
                ${status.languageServerConfigured !== undefined ? `
                <div class="row">
                    <span class="row-label">Language Server</span>
                    <span class="row-value ${status.languageServerConfigured ? 'on' : 'off'}">${status.languageServerConfigured ? 'Configured' : 'Not Configured'}</span>
                </div>
                ` : ''}
                `}
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Configuration</div>
            <div class="card">
                ${isLocal ? `
                <div class="input-row">
                    <label>Enable Forwarding</label>
                    <label class="toggle">
                        <input type="checkbox" id="enableForwarding" ${enableForwarding ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>
                <div class="input-row">
                    <label>Local Proxy Port</label>
                    <input type="number" id="localProxyPort" value="${status.localProxyPort}" min="1" max="65535">
                </div>
                <div class="input-row">
                    <label>Remote Port</label>
                    <input type="number" id="remoteProxyPort" value="${status.remoteProxyPort}" min="1" max="65535">
                </div>
                ` : `
                <div class="input-row">
                    <label>Proxy Host</label>
                    <input type="text" id="remoteProxyHost" value="${status.remoteProxyHost}">
                </div>
                <div class="input-row">
                    <label>Proxy Port</label>
                    <input type="number" id="remoteProxyPort" value="${status.remoteProxyPort}" min="1" max="65535">
                </div>
                `}
            </div>
        </div>
        
        <div class="actions">
            <button class="btn btn-secondary" onclick="refresh()">
                <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.5 2a.5.5 0 0 0-.5.5V5h-2.5a.5.5 0 0 0 0 1H14a.5.5 0 0 0 .5-.5V2.5a.5.5 0 0 0-.5-.5z"/>
                    <path d="M8 3a5 5 0 1 0 4.546 7.086.5.5 0 0 0-.908-.417A4 4 0 1 1 8 4a.5.5 0 0 0 0-1z"/>
                </svg>
                Refresh
            </button>
            <button class="btn btn-primary" onclick="saveConfig()">
                <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                </svg>
                Save
            </button>
        </div>
        
        <div class="actions" style="margin-top: 8px;">
            <button class="btn btn-secondary" onclick="openDiagnostics()">
                <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                    <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
                </svg>
                Diagnose
            </button>
            ${!isLocal ? `
            <button class="btn btn-secondary" onclick="openTrafficPanel()">
                <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 0h1v15h15v1H0V0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07z"/>
                </svg>
                Traffic
            </button>
            ` : ''}
        </div>
        
        <div class="section">
            <div class="section-title-row">
                <span class="section-title">Tips</span>
                <div class="lang-switch">
                    <span class="lang-label" id="langLabel">EN</span>
                    <label class="toggle toggle-small">
                        <input type="checkbox" id="langToggle" onchange="toggleLang()">
                        <span class="toggle-slider"></span>
                    </label>
                    <span class="lang-label">CN</span>
                </div>
            </div>
            <div class="tip-card">
                <div class="tip-icon">💡</div>
                <div class="tip-content" id="tipContent">
                    <!-- Content will be set by JavaScript -->
                </div>
            </div>
        </div>
        
        <div class="footer">
            <span>Auto refresh in <span class="countdown-num" id="countdown">${this.secondsUntilRefresh}</span>s</span>
            <span>Updated ${status.lastUpdated.toLocaleTimeString()}</span>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const isLocal = ${isLocal};
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        
        function saveConfig() {
            const config = {};
            if (isLocal) {
                config.enableLocalForwarding = document.getElementById('enableForwarding').checked;
                config.localProxyPort = parseInt(document.getElementById('localProxyPort').value);
                config.remoteProxyPort = parseInt(document.getElementById('remoteProxyPort').value);
            } else {
                config.remoteProxyHost = document.getElementById('remoteProxyHost').value;
                config.remoteProxyPort = parseInt(document.getElementById('remoteProxyPort').value);
            }
            vscode.postMessage({ command: 'saveConfig', config });
        }
        
        function openDiagnostics() {
            vscode.postMessage({ command: 'openDiagnostics' });
        }
        
        function openTrafficPanel() {
            vscode.postMessage({ command: 'openTrafficPanel' });
        }
        
        function closeRemote() {
            vscode.postMessage({ command: 'closeRemote' });
        }
        
        // Language toggle
        const tips = {
            local: {
                en: \`
                    <div class="tip-title">🚀 Correct Connection Flow</div>
                    <ul class="tip-steps">
                        <li class="tip-step"><span class="step-num">1</span><span class="step-text">Start your <strong>local proxy</strong> (e.g., Clash, V2Ray) on your computer</span></li>
                        <li class="tip-step"><span class="step-num">2</span><span class="step-text"><strong>Open a local Antigravity window first</strong> — this configures SSH tunnel</span></li>
                        <li class="tip-step"><span class="step-num">3</span><span class="step-text">Connect to remote server from the local window</span></li>
                        <li class="tip-step"><span class="step-num">4</span><span class="step-text">Reload remote window if prompted</span></li>
                    </ul>
                    <div class="tip-note">⚠️ <strong>Do NOT</strong> connect directly via Antigravity's recent connections. Always open a local window first!</div>
                \`,
                cn: \`
                    <div class="tip-title">🚀 正确的连接流程</div>
                    <ul class="tip-steps">
                        <li class="tip-step"><span class="step-num">1</span><span class="step-text">在本地电脑启动<strong>代理软件</strong>（如 Clash、V2Ray）</span></li>
                        <li class="tip-step"><span class="step-num">2</span><span class="step-text"><strong>先打开一个本地 Antigravity 窗口</strong> — 这会配置 SSH 隧道</span></li>
                        <li class="tip-step"><span class="step-num">3</span><span class="step-text">从本地窗口连接到远程服务器</span></li>
                        <li class="tip-step"><span class="step-num">4</span><span class="step-text">如有提示，重新加载远程窗口</span></li>
                    </ul>
                    <div class="tip-note">⚠️ <strong>不要</strong>通过 Antigravity 的"最近连接"直接连接远程！务必先打开本地窗口！</div>
                \`
            },
            remote: {
                en: \`
                    <div class="tip-title">🔧 Troubleshooting</div>
                    <ul class="tip-steps">
                        <li class="tip-step"><span class="step-num">1</span><span class="step-text">If proxy is <strong>unreachable</strong>, the SSH tunnel was not established</span></li>
                        <li class="tip-step"><span class="step-num">2</span><span class="step-text"><strong>Close this remote connection</strong></span></li>
                        <li class="tip-step"><span class="step-num">3</span><span class="step-text">Open a <strong>new local window</strong> first (File → New Window)</span></li>
                        <li class="tip-step"><span class="step-num">4</span><span class="step-text">Then connect to remote from the local window</span></li>
                    </ul>
                    <div class="tip-note">💡 This usually happens when you connect directly via Antigravity's recent connections without opening a local window first.</div>
                \`,
                cn: \`
                    <div class="tip-title">🔧 故障排除</div>
                    <ul class="tip-steps">
                        <li class="tip-step"><span class="step-num">1</span><span class="step-text">如果代理<strong>不可达</strong>，说明 SSH 隧道未建立</span></li>
                        <li class="tip-step"><span class="step-num">2</span><span class="step-text"><strong>关闭当前远程连接</strong></span></li>
                        <li class="tip-step"><span class="step-num">3</span><span class="step-text">先打开一个<strong>新的本地窗口</strong>（文件 → 新建窗口）</span></li>
                        <li class="tip-step"><span class="step-num">4</span><span class="step-text">然后从本地窗口连接到远程服务器</span></li>
                    </ul>
                    <div class="tip-note">💡 这通常发生在你通过 Antigravity 的"最近连接"直接连接远程，而没有先打开本地窗口的情况下。</div>
                \`
            }
        };
        
        let currentLang = '${savedLang}';
        
        function toggleLang() {
            currentLang = document.getElementById('langToggle').checked ? 'cn' : 'en';
            updateTipContent();
            // Save preference
            vscode.postMessage({ command: 'saveLangPreference', lang: currentLang });
        }
        
        function updateTipContent() {
            const content = isLocal ? tips.local[currentLang] : tips.remote[currentLang];
            document.getElementById('tipContent').innerHTML = content;
        }
        
        // Initialize with saved preference
        document.getElementById('langToggle').checked = currentLang === 'cn';
        updateTipContent();
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateCountdown') {
                const el = document.getElementById('countdown');
                if (el) el.textContent = message.seconds;
            }
        });
    </script>
</body>
</html>`;
    }

    dispose(): void {
        this.stopAutoRefresh();
        this.statusBarItem.dispose();
        this.statusPanel?.dispose();
        this.updateCallbacks = [];
    }
}
