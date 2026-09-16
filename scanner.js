const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const qrcode = require('qrcode');

const {
    default: makeWASocket,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const BASE_SESSIONS_PATH = './sessions';
const RESULTS_PATH = './results';
const PROGRESS_FILE = './progress.json';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Ø¥Ù†Ø´Ø§Ø¡ Ø¬Ù„Ø³Ø© Ø­Ø³Ø§Ø¨ ÙˆØ§ØªØ³Ø§Ø¨ Ù…Ø¹ Ø¥Ø±Ø³Ø§Ù„ Ø¨Ø§Ø±ÙƒÙˆØ¯ Ø§Ù„ØªØ³Ø¬ÙŠÙ„ Ù…Ø¨Ø§Ø´Ø±Ø© Ù„ØªÙŠÙ„ÙŠØ¬Ø±Ø§Ù…
 */
async function getWaSocket(accountIndex, ctx) {
    const sessionDir = path.join(BASE_SESSIONS_PATH, `account${accountIndex}`);
    await fsPromises.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    return new Promise((resolve, reject) => {
        let connected = false;
        let closed = false;

        const timeout = setTimeout(() => {
            if (!connected && !closed) {
                closed = true;
                reject(new Error(`Ø§Ù†ØªÙ‡Øª Ù…Ù‡Ù„Ø© Ø§Ù„Ø§ØªØµØ§Ù„ Ù„Ù„Ø­Ø³Ø§Ø¨ ${accountIndex} (ÙŠØ±Ø¬Ù‰ Ø§Ù„ØªØ£ÙƒØ¯ Ù…Ù† Ù…Ø³Ø­ Ø§Ù„Ø¨Ø§Ø±ÙƒÙˆØ¯)`));
            }
        }, 60000);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`ðŸ“± ØªÙ… ØªÙˆÙ„ÙŠØ¯ QR Code Ù„Ù„Ø­Ø³Ø§Ø¨ Ø±Ù‚Ù… ${accountIndex}`);
                try {
                    const qrBuffer = await qrcode.toBuffer(qr);
                    await ctx.replyWithPhoto(
                        { source: qrBuffer },
                        { 
                            caption: `ðŸ“¸ **ÙŠØ±Ø¬Ù‰ Ù…Ø³Ø­ Ø±Ù…Ø² Ø§Ù„Ø§Ø³ØªØ¬Ø§Ø¨Ø© Ø§Ù„Ø³Ø±ÙŠØ¹ (QR) Ù„Ù„Ø­Ø³Ø§Ø¨ Ø±Ù‚Ù… (${accountIndex}) Ù…Ù† ØªØ·Ø¨ÙŠÙ‚ ÙˆØ§ØªØ³Ø§Ø¨:**\n\n` +
                                     `1. Ø§ÙØªØ­ ÙˆØ§ØªØ³Ø§Ø¨ ÙÙŠ Ù‡Ø§ØªÙÙƒ.\n` +
                                     `2. Ø§Ø°Ù‡Ø¨ Ø¥Ù„Ù‰ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª > Ø§Ù„Ø£Ø¬Ù‡Ø²Ø© Ø§Ù„Ù…Ø±ØªØ¨Ø·Ø© > Ø±Ø¨Ø· Ø¬Ù‡Ø§Ø².\n` +
                                     `3. Ø§Ù…Ø³Ø­ Ø§Ù„ÙƒÙˆØ¯ Ø£Ø¹Ù„Ø§Ù‡.` 
                        }
                    );
                } catch (qrErr) {
                    console.error('Ø®Ø·Ø£ ÙÙŠ Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ù€ QR:', qrErr);
                }
            }

            if (connection === 'open' && !connected) {
                connected = true;
                clearTimeout(timeout);
                console.log(`âœ… ØªÙ… Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù€ WhatsApp Ø¨Ù†Ø¬Ø§Ø­ Ù„Ù„Ø­Ø³Ø§Ø¨ ${accountIndex}`);
                await ctx.reply(`âœ… **ØªÙ… Ø±Ø¨Ø· ÙˆØªÙˆØµÙŠÙ„ Ø§Ù„Ø­Ø³Ø§Ø¨ Ø±Ù‚Ù… (${accountIndex}) Ø¨Ù†Ø¬Ø§Ø­!**`);
                resolve(sock);
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || '';
                
                console.log(`âš ï¸ Ø§Ù†Ù‚Ø·Ø¹ Ø§Ù„Ø§ØªØµØ§Ù„ Ù„Ù„Ø­Ø³Ø§Ø¨ ${accountIndex} - Ø§Ù„ÙƒÙˆØ¯: ${statusCode}`);

                if (statusCode === 515 || errorMessage.includes('restart required')) {
                    console.log('ðŸ”„ Ø¥Ø¹Ø§Ø¯Ø© ØªØ´ØºÙŠÙ„ Ø§Ù„Ø§ØªØµØ§Ù„ ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ (Ø±Ù…Ø² 515)...');
                    setTimeout(async () => {
                        try {
                            const newSock = await getWaSocket(accountIndex, ctx);
                            resolve(newSock);
                        } catch (e) {
                            reject(e);
                        }
                    }, 3000);
                } else if (!connected && !closed) {
                    closed = true;
                    clearTimeout(timeout);
                    reject(new Error(`ØªÙ… Ø¥ØºÙ„Ø§Ù‚ Ø§ØªØµØ§Ù„ Ø§Ù„Ø­Ø³Ø§Ø¨ ${accountIndex}. Ø§Ù„ÙƒÙˆØ¯: ${statusCode || 'ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ'}`));
                }
            }
        });
    });
}

/**
 * Ø¯Ø§Ù„Ø© Ø§Ù„ÙØ­Øµ Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ© Ø§Ù„Ù…ØªØ¹Ø¯Ø¯Ø© Ø§Ù„Ø­Ø³Ø§Ø¨Ø§Øª
 */
async function startMultiAccountScanner(usernamesFile, scanConfig = {}, ctx, onProgress = async () => {}, control = {}) {
    if (!fs.existsSync(usernamesFile)) {
        throw new Error('Ù…Ù„Ù usernames.txt ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯');
    }

    const accountsCount = scanConfig.accountsCount || 1;
    const delayMs = scanConfig.delayMs || 300;
    const switchInterval = scanConfig.switchInterval || 1;

    await fsPromises.mkdir(RESULTS_PATH, { recursive: true });

    const fileContent = await fsPromises.readFile(usernamesFile, 'utf8');
    const usernames = fileContent
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

    if (usernames.length === 0) {
        throw new Error('Ø§Ù„Ù…Ù„Ù ÙØ§Ø±Øº ÙˆÙ„Ø§ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ Ø£Ø³Ù…Ø§Ø¡ Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†');
    }

    const fileHash = await getFileHash(usernamesFile);

    let progress = {
        fileHash,
        index: 0,
        total: usernames.length,
        lastUsername: '-',
        availableCount: 0
    };

    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            const savedData = await fsPromises.readFile(PROGRESS_FILE, 'utf8');
            const saved = JSON.parse(savedData);

            if (saved.fileHash === fileHash && saved.total === usernames.length) {
                progress = {
                    fileHash,
                    index: typeof saved.index === 'number' ? saved.index : 0,
                    total: usernames.length,
                    lastUsername: saved.lastUsername || '-',
                    availableCount: typeof saved.availableCount === 'number' ? saved.availableCount : 0
                };
            }
        } catch {}
    }

    if (progress.index === 0) {
        await fsPromises.writeFile(path.join(RESULTS_PATH, 'available.txt'), '');
        await fsPromises.writeFile(path.join(RESULTS_PATH, 'taken.txt'), '');
    }

    async function saveProgress() {
        await fsPromises.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    }

    await saveProgress();

    if (progress.index >= usernames.length) {
        await onProgress({
            type: 'completed',
            current: progress.index,
            total: usernames.length,
            username: progress.lastUsername,
            availableCount: progress.availableCount,
            activeAccount: 1
        });
        return;
    }

    let activeAccountIndex = 1;
    let sock = await getWaSocket(activeAccountIndex, ctx);

    for (let i = progress.index; i < usernames.length; i++) {
        while (control.isPaused && !control.isCancelled) {
            await sleep(300);
        }

        if (control.isCancelled) {
            try { sock.ws?.close(); } catch {}
            await ctx.reply('ðŸ›‘ **ØªÙ… Ø¥ÙŠÙ‚Ø§Ù ÙˆØªØµÙÙŠØ± Ø¹Ù…Ù„ÙŠØ© Ø§Ù„ÙØ­Øµ Ø¨Ù†Ø§Ø¡Ù‹ Ø¹Ù„Ù‰ Ø·Ù„Ø¨Ùƒ.**');
            return;
        }

        const checkCount = i - progress.index;
        if (checkCount > 0 && checkCount % switchInterval === 0 && accountsCount > 1) {
            try { sock.ws?.close(); } catch {}
            activeAccountIndex = (activeAccountIndex % accountsCount) + 1;
            await ctx.reply(`ðŸ”„ **Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªØ¨Ø¯ÙŠÙ„ Ø¥Ù„Ù‰ Ø§Ù„Ø­Ø³Ø§Ø¨ Ø±Ù‚Ù… (${activeAccountIndex})...**`);
            sock = await getWaSocket(activeAccountIndex, ctx);
        }

        const username = usernames[i];

        try {
            const result = await sock.checkUsername(username);
            const available = result?.available === true;

            const targetFile = available ? 'available.txt' : 'taken.txt';
            await fsPromises.appendFile(path.join(RESULTS_PATH, targetFile), `${username}\n`);

            if (available) {
                progress.availableCount++;
            }

            progress.index = i + 1;
            progress.lastUsername = username;
            await saveProgress();

            await onProgress({
                type: 'progress',
                current: progress.index,
                total: usernames.length,
                username,
                available,
                availableCount: progress.availableCount,
                activeAccount: activeAccountIndex
            });

            await sleep(delayMs);

        } catch (error) {
            await saveProgress();
            try { sock.ws?.close(); } catch {}

            const errMessage = error?.message || String(error);
            const isRateLimit = errMessage.includes('429') || 
                                errMessage.toLowerCase().includes('rate limit') || 
                                errMessage.toLowerCase().includes('resource-exhausted');

            await ctx.reply(`âš ï¸ Ø®Ø·Ø£ ÙÙŠ ÙØ­Øµ Ø§Ù„ÙŠÙˆØ²Ø± \`${username}\`: ${errMessage}`);
            
            await sleep(5000);
            sock = await getWaSocket(activeAccountIndex, ctx);
        }
    }

    try { sock.ws?.close(); } catch {}
    await ctx.reply('ðŸŽ‰ **ØªÙ… Ø§Ù„Ø§Ù†ØªÙ‡Ø§Ø¡ Ù…Ù† ÙØ­Øµ Ø¬Ù…ÙŠØ¹ Ø§Ù„ÙŠÙˆØ²Ø±Ø§Øª Ø¨Ù†Ø¬Ø§Ø­!**');
}

module.exports = {
    startScanner: startMultiAccountScanner,
    startMultiAccountScanner
};