const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./sessions/account1');
  const sock = makeWASocket({ auth: state, printQRInTerminal: true, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  return new Promise((resolve, reject) => {
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => { if (!err) console.log(url); });
      }
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) { connectWhatsApp().then(resolve).catch(reject); }
        else { reject(new Error('Session logged out.')); }
      } else if (connection === 'open') {
        console.log('✅ WhatsApp successfully connected!');
        resolve(sock);
      }
    });
  });
}

async function main() {
  try {
    console.log('جاري تشغيل البوت...');
    const sock = await connectWhatsApp();
  } catch (error) {
    console.error('حدث خطأ غير متوقع:', error);
  }
}

main();