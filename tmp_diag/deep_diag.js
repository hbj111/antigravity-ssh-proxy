const { Client } = require('ssh2');
const conn = new Client();
const config = { host: '192.168.0.51', port: 22, username: 'linaro', password: 'linaro' };

const commands = [
    'echo "=== LS BINARIES LOCATION ==="',
    'find ~/.antigravity-server/bin -name "language_server_linux_*"',
    'echo "=== RUNNING PROCESSES (DETAILED) ==="',
    'ps aux | grep -v grep | grep -E "language_server|mgraftcp"',
    'echo "=== WRAPPER SCRIPT VERIFICATION ==="',
    'for f in $(find ~/.antigravity-server/bin -name "language_server_linux_arm" -type f); do if grep -q "mgraftcp" "$f"; then echo "VALID WRAPPER: $f"; else echo "NOT A WRAPPER: $f"; fi; done',
    'echo "=== MGRAFTCP LOGS (TAIL) ==="',
    'tail -n 20 /tmp/mgraftcp.log 2>/dev/null || echo "No mgraftcp.log found"',
    'echo "=== CONNECTIVITY TEST (FINAL) ==="',
    'curl -I --proxy http://127.0.0.1:2499 https://www.google.com 2>&1 | grep "HTTP/"'
];

conn.on('ready', () => {
    console.log('SSH Ready');
    conn.exec(commands.join(' && echo "" && '), (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
              .on('data', data => process.stdout.write(data))
              .stderr.on('data', data => process.stderr.write(data));
    });
}).on('error', err => console.error('SSH Error:', err)).connect(config);
