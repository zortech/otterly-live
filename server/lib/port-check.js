const net = require('net');

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

async function checkPorts() {
  const settings = require('../settings');
  const [rtmpPort, serverPort] = await Promise.all([
    settings.get('rtmp.port'),
    settings.get('server.port'),
  ]);

  const issues = [];
  const [rtmpFree, serverFree] = await Promise.all([
    isPortFree(rtmpPort),
    isPortFree(serverPort),
  ]);

  if (!rtmpFree) issues.push(`Port ${rtmpPort} (RTMP) is already in use`);
  if (!serverFree) issues.push(`Port ${serverPort} (HTTP/API) is already in use`);
  return issues;
}

module.exports = { checkPorts, isPortFree };
