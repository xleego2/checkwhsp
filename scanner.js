const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');

async function startMultiAccountScanner() {
  const { state, saveCreds } = await useMultiFileAuthState('./sessions/account1');
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: true
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => { if (!err) console.log(url); });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Connection closed due to ', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => { startMultiAccountScanner(); }, 5000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp successfully connected!');
    }
  });
  return sock;
}

module.exports = { startMultiAccountScanner };