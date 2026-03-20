const { Client } = require('ssh2');
const conn = new Client();
const config = {
    host: '192.168.0.51', port: 22, username: 'linaro', password: 'linaro',
};

const commands = [
    'echo "=== SYSTEM ARCH ==="',
    'uname -m',
    'echo "=== LS BINARIES ==="',
    'find ~/.antigravity-server/bin -name "language_server_linux_*" -type f -exec file {} \\;',
    'echo "=== CURRENT WRAPPER CONTENT ==="',
    'find ~/.antigravity-server/bin -name "language_server_linux_*" -type f -exec grep -l "mgraftcp" {} \\; | xargs -I{} head -n 20 {}',
    'echo "=== RUNNING PROCESSES ==="',
    'ps aux | grep -E "mgraftcp|language_server" | grep -v grep'
];

conn.on('ready', () => {
    console.log('SSH Ready');
    conn.exec(commands.join(' && echo "" && '), (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
              .on('data', data => process.stdout.write(data))
              .stderr.on('data', data => process.stderr.write(data));
    });
}).on('error', err => {
    console.error('SSH Error:', err.message);
}).connect(config);
