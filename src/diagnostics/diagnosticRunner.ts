import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DiagnosticCheck {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'success' | 'warning' | 'error';
    message?: string;
    suggestion?: string;
}

export interface DiagnosticReport {
    timestamp: Date;
    checks: DiagnosticCheck[];
    overallStatus: 'healthy' | 'degraded' | 'broken';
}

type ProgressCallback = (checks: DiagnosticCheck[]) => void;

function isRunningLocally(): boolean {
    return !vscode.env.remoteName;
}

/**
 * Check if a port is reachable
 */
function checkPort(host: string, port: number, timeout: number = 3000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.connect(port, host);
    });
}

/**
 * Get SSH config path
 */
function getSSHConfigPath(): string {
    return path.join(os.homedir(), '.ssh', 'config');
}

/**
 * Check local proxy service
 */
async function checkLocalProxy(localProxyPort: number): Promise<DiagnosticCheck> {
    const check: DiagnosticCheck = {
        id: 'local-proxy',
        name: 'Local Proxy Service',
        status: 'running'
    };

    try {
        const reachable = await checkPort('127.0.0.1', localProxyPort);
        if (reachable) {
            check.status = 'success';
            check.message = `Local proxy is running on port ${localProxyPort}`;
        } else {
            check.status = 'error';
            check.message = `Cannot connect to local proxy on port ${localProxyPort}`;
            check.suggestion = 'Please ensure your local proxy (e.g., Clash, V2Ray) is running and listening on the configured port.';
        }
    } catch (error) {
        check.status = 'error';
        check.message = `Error checking local proxy: ${error}`;
        check.suggestion = 'Please check if your proxy software is installed and running.';
    }

    return check;
}

/**
 * Check SSH config for RemoteForward
 */
async function checkSSHConfig(remoteProxyPort: number): Promise<DiagnosticCheck> {
    const check: DiagnosticCheck = {
        id: 'ssh-config',
        name: 'SSH Configuration',
        status: 'running'
    };

    try {
        const configPath = getSSHConfigPath();
        const content = await fs.readFile(configPath, 'utf-8');
        
        // Check for Include line
        if (content.includes('Include config.antigravity')) {
            // Check the antigravity config file
            const antiConfigPath = path.join(os.homedir(), '.ssh', 'config.antigravity');
            try {
                const antiContent = await fs.readFile(antiConfigPath, 'utf-8');
                const match = antiContent.match(/RemoteForward\s+(\d+)\s+/);
                if (match) {
                    const configuredPort = parseInt(match[1]);
                    if (configuredPort === remoteProxyPort) {
                        check.status = 'success';
                        check.message = `SSH RemoteForward configured for port ${remoteProxyPort}`;
                    } else {
                        check.status = 'warning';
                        check.message = `RemoteForward port mismatch: configured ${configuredPort}, expected ${remoteProxyPort}`;
                        check.suggestion = 'Run "Enable Port Forwarding" command to update the SSH configuration.';
                    }
                } else {
                    check.status = 'error';
                    check.message = 'RemoteForward directive not found in config.antigravity';
                    check.suggestion = 'Run "Enable Port Forwarding" command to configure SSH.';
                }
            } catch {
                check.status = 'error';
                check.message = 'config.antigravity file not found';
                check.suggestion = 'Run "Enable Port Forwarding" command to create SSH configuration.';
            }
        } else {
            check.status = 'error';
            check.message = 'SSH config does not include config.antigravity';
            check.suggestion = 'Run "Enable Port Forwarding" command to configure SSH.';
        }
    } catch {
        check.status = 'error';
        check.message = 'Cannot read SSH config file';
        check.suggestion = 'Ensure ~/.ssh/config exists and is readable.';
    }

    return check;
}

/**
 * Check remote port forwarding
 */
async function checkRemotePortForward(remoteProxyHost: string, remoteProxyPort: number): Promise<DiagnosticCheck> {
    const check: DiagnosticCheck = {
        id: 'remote-forward',
        name: 'Remote Port Forwarding',
        status: 'running'
    };

    try {
        const reachable = await checkPort(remoteProxyHost, remoteProxyPort);
        if (reachable) {
            check.status = 'success';
            check.message = `Remote proxy port ${remoteProxyHost}:${remoteProxyPort} is reachable`;
        } else {
            check.status = 'error';
            check.message = `Cannot connect to ${remoteProxyHost}:${remoteProxyPort}`;
            check.suggestion = 'Reconnect to the remote server to establish the SSH tunnel. Check if the port is occupied on the remote server.';
        }
    } catch (error) {
        check.status = 'error';
        check.message = `Error checking remote port: ${error}`;
        check.suggestion = 'Please reconnect to the remote server.';
    }

    return check;
}

/**
 * Check mgraftcp availability
 */
async function checkMgraftcp(): Promise<DiagnosticCheck> {
    const check: DiagnosticCheck = {
        id: 'mgraftcp',
        name: 'mgraftcp Binary',
        status: 'running'
    };

    try {
        const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
        const binaryName = `mgraftcp-linux-${arch}`;
        
        // Search for mgraftcp in extension directories
        const searchPattern = `${os.homedir()}/.antigravity-server/extensions/*antigravity-ssh-proxy*/resources/bin/${binaryName}`;
        const { stdout } = await execAsync(`ls ${searchPattern} 2>/dev/null | head -1`);
        const binaryPath = stdout.trim();

        if (binaryPath) {
            // Check if executable
            await fs.access(binaryPath, fs.constants.X_OK);
            check.status = 'success';
            check.message = `mgraftcp found at ${binaryPath}`;
        } else {
            check.status = 'error';
            check.message = 'mgraftcp binary not found';
            check.suggestion = 'Reinstall the Antigravity SSH Proxy extension.';
        }
    } catch (error) {
        check.status = 'error';
        check.message = `Error checking mgraftcp: ${error}`;
        check.suggestion = 'Ensure the extension is properly installed.';
    }

    return check;
}

/**
 * Check language server wrapper
 */
async function checkLanguageServerWrapper(): Promise<DiagnosticCheck> {
    const check: DiagnosticCheck = {
        id: 'ls-wrapper',
        name: 'Language Server Wrapper',
        status: 'running'
    };

    try {
        const { stdout } = await execAsync(
            `find "$HOME/.antigravity-server/bin" -path "*/extensions/antigravity/bin/language_server_linux_*" -type f 2>/dev/null | grep -v ".bak$" | head -1`
        );
        const targetPath = stdout.trim();

        if (!targetPath) {
            check.status = 'warning';
            check.message = 'Language server binary not found';
            check.suggestion = 'This may be normal if Antigravity extension is not installed.';
            return check;
        }

        // Check if it's a wrapper script
        const content = await fs.readFile(targetPath, 'utf-8');
        if (content.startsWith('#!/bin/bash') && content.includes('mgraftcp')) {
            check.status = 'success';
            check.message = 'Language server wrapper is configured';
        } else {
            check.status = 'warning';
            check.message = 'Language server is not wrapped with mgraftcp';
            check.suggestion = 'Run "Setup Remote Environment" command to configure the wrapper.';
        }
    } catch (error) {
        check.status = 'warning';
        check.message = `Could not verify wrapper: ${error}`;
        check.suggestion = 'Run "Setup Remote Environment" command if language server proxy is needed.';
    }

    return check;
}

/**
 * Check external connectivity through proxy
 * Tries multiple proxy protocols: socks5h (DNS via proxy), http, socks5
 */
async function checkExternalConnectivity(remoteProxyHost: string, remoteProxyPort: number): Promise<DiagnosticCheck> {
    const check: DiagnosticCheck = {
        id: 'external-connectivity',
        name: 'External Connectivity',
        status: 'running'
    };

    // Try multiple proxy protocols - some environments may only support certain types
    // socks5h: SOCKS5 with DNS resolution through proxy (best for restricted networks)
    // http: HTTP proxy (common for Clash/V2Ray mixed ports)
    // socks5: SOCKS5 with local DNS resolution
    const proxyProtocols = ['socks5h', 'http', 'socks5'];
    
    for (const protocol of proxyProtocols) {
    try {
        const { stdout } = await execAsync(
                `curl -x ${protocol}://${remoteProxyHost}:${remoteProxyPort} https://www.google.com -o /dev/null -s -w "%{http_code}" --connect-timeout 10`,
            { timeout: 15000 }
        );
        const httpCode = stdout.trim();

        if (httpCode === '200' || httpCode === '301' || httpCode === '302') {
            check.status = 'success';
                check.message = `External connectivity OK via ${protocol} (HTTP ${httpCode})`;
                return check;
            }
        } catch {
            // Try next protocol
            continue;
        }
    }

    // All protocols failed
            check.status = 'error';
    check.message = 'Cannot connect to external network via any proxy protocol';
    check.suggestion = 'Check if the proxy is properly forwarding traffic. Verify your local proxy has internet access and supports SOCKS5 or HTTP proxy.';

    return check;
}

/**
 * Run all diagnostic checks
 */
export async function runDiagnostics(onProgress?: ProgressCallback): Promise<DiagnosticReport> {
    const config = vscode.workspace.getConfiguration('antigravity-ssh-proxy');
    const localProxyPort = config.get<number>('localProxyPort', 7890);
    const remoteProxyPort = config.get<number>('remoteProxyPort', 7890);
    const remoteProxyHost = config.get<string>('remoteProxyHost', '127.0.0.1');
    const isLocal = isRunningLocally();

    // Initialize all checks as pending
    const checks: DiagnosticCheck[] = [
        { id: 'local-proxy', name: 'Local Proxy Service', status: 'pending' },
        { id: 'ssh-config', name: 'SSH Configuration', status: 'pending' },
        { id: 'remote-forward', name: 'Remote Port Forwarding', status: 'pending' },
        { id: 'mgraftcp', name: 'mgraftcp Binary', status: 'pending' },
        { id: 'ls-wrapper', name: 'Language Server Wrapper', status: 'pending' },
        { id: 'external-connectivity', name: 'External Connectivity', status: 'pending' }
    ];

    const updateCheck = (index: number, check: DiagnosticCheck) => {
        checks[index] = check;
        onProgress?.(checks);
    };

    // Run checks sequentially
    if (isLocal) {
        // Local environment: check steps 1-2
        checks[0].status = 'running';
        onProgress?.(checks);
        updateCheck(0, await checkLocalProxy(localProxyPort));

        checks[1].status = 'running';
        onProgress?.(checks);
        updateCheck(1, await checkSSHConfig(remoteProxyPort));

        // Skip remote-only checks
        for (let i = 2; i < 6; i++) {
            checks[i].status = 'warning';
            checks[i].message = 'Skipped (remote-only check)';
        }
        onProgress?.(checks);
    } else {
        // Remote environment: skip local checks
        checks[0].status = 'warning';
        checks[0].message = 'Skipped (local-only check)';
        checks[1].status = 'warning';
        checks[1].message = 'Skipped (local-only check)';
        onProgress?.(checks);

        // Run remote checks
        checks[2].status = 'running';
        onProgress?.(checks);
        updateCheck(2, await checkRemotePortForward(remoteProxyHost, remoteProxyPort));

        checks[3].status = 'running';
        onProgress?.(checks);
        updateCheck(3, await checkMgraftcp());

        checks[4].status = 'running';
        onProgress?.(checks);
        updateCheck(4, await checkLanguageServerWrapper());

        checks[5].status = 'running';
        onProgress?.(checks);
        updateCheck(5, await checkExternalConnectivity(remoteProxyHost, remoteProxyPort));
    }

    // Determine overall status
    const errorCount = checks.filter(c => c.status === 'error').length;
    const warningCount = checks.filter(c => c.status === 'warning' && !c.message?.includes('Skipped')).length;
    
    let overallStatus: 'healthy' | 'degraded' | 'broken';
    if (errorCount > 0) {
        overallStatus = 'broken';
    } else if (warningCount > 0) {
        overallStatus = 'degraded';
    } else {
        overallStatus = 'healthy';
    }

    return {
        timestamp: new Date(),
        checks,
        overallStatus
    };
}

/**
 * Generate a text report for copying
 */
export function generateReportText(report: DiagnosticReport): string {
    const lines: string[] = [
        '=== Antigravity SSH Proxy Diagnostic Report ===',
        `Timestamp: ${report.timestamp.toISOString()}`,
        `Overall Status: ${report.overallStatus.toUpperCase()}`,
        `Environment: ${isRunningLocally() ? 'Local' : 'Remote'}`,
        '',
        '--- Checks ---'
    ];

    for (const check of report.checks) {
        const icon = check.status === 'success' ? '✓' : 
                     check.status === 'warning' ? '⚠' : 
                     check.status === 'error' ? '✗' : '○';
        lines.push(`[${icon}] ${check.name}: ${check.message || check.status}`);
        if (check.suggestion) {
            lines.push(`    Suggestion: ${check.suggestion}`);
        }
    }

    lines.push('');
    lines.push('=== End of Report ===');
    return lines.join('\n');
}

