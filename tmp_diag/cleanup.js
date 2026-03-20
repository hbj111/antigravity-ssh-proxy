const { Client } = require('ssh2');
const conn = new Client();
const config = { host: '192.168.0.51', port: 22, username: 'linaro', password: 'linaro' };

conn.on('ready', () => {
    console.log('SSH Ready for Cleanup');
    const cmds = [
        'pkill -f language_server_linux || true',
        'pkill -f mgraftcp || true',
        'rm -rf /home/linaro/.antigravity-server/extensions/dinobot22.antigravity-ssh-proxy-*',
        'rm -f /home/linaro/.antigravity-server/extensions/.obsolete',
        'find /home/linaro/.antigravity-server/bin -name "*.bak" | while read bak; do target="${bak%.bak}"; echo "Restoring $target"; mv "$bak" "$target" || true; done'
    ];
    conn.exec(cmds.join('; '), (err, stream) => {
        if (err) throw err;
        stream.on('close', () => {
            console.log('Deep Cleanup Finished');
            conn.end();
        }).on('data', data => process.stdout.write(data)).stderr.on('data', data => process.stderr.write(data));
    });
}).on('error', err => console.error('SSH Error:', err)).connect(config);
