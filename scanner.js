const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');

async function startMultiAccountScanner() {
  const { state, saveCreds } = await useMultiFileAuthState('./sessions/account1');
  const sock = makeWASocket({ auth: state, printQRInTerminal: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => { if (!err) console.log(url); });
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) { startMultiAccountScanner(); }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp successfully connected!');
    }
  });
  return sock;
}

module.exports = { startMultiAccountScanner };