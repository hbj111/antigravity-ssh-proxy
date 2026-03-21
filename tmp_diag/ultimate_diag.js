const { Client } = require('ssh2');
const conn = new Client();
const config = { host: '192.168.0.51', port: 22, username: 'linaro', password: 'linaro' };

const commands = [
    'echo "=== SERVER INTERNAL LOG ==="',
    'tail -n 100 ~/.antigravity-server/.135ccf460c67c4b900dc10aa71c978f27d78601c.log',
    'echo "=== WRAPPER PERMISSIONS ==="',
    'ls -l $(find ~/.antigravity-server/bin -name "language_server_linux_arm" -type f)',
    'echo "=== CHECKING FOR CRASH DUMPS ==="',
    'find ~/.antigravity-server -name "core" -ls'
];

conn.on('ready', () => {
    conn.exec(commands.join(' && echo "" && '), (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
              .on('data', data => process.stdout.write(data));
    });
}).on('error', err => console.error('SSH Error:', err)).connect(config);
