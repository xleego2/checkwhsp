const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const qrcode = require('qrcode');

const {
    default: makeWASocket,
    useMultiFileAuthState
} = require('@dexterid/baileys');

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
 * إنشاء جلسة حساب واتساب مع إرسال باركود التسجيل مباشرة لتيليجرام
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
                reject(new Error(`انتهت مهلة الاتصال للحساب ${accountIndex} (يرجى التأكد من مسح الباركود)`));
            }
        }, 60000);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`📱 تم توليد QR Code للحساب رقم ${accountIndex}`);
                try {
                    const qrBuffer = await qrcode.toBuffer(qr);
                    await ctx.replyWithPhoto(
                        { source: qrBuffer },
                        { 
                            caption: `📸 **يرجى مسح رمز الاستجابة السريع (QR) للحساب رقم (${accountIndex}) من تطبيق واتساب:**\n\n` +
                                     `1. افتح واتساب في هاتفك.\n` +
                                     `2. اذهب إلى الإعدادات > الأجهزة المرتبطة > ربط جهاز.\n` +
                                     `3. امسح الكود أعلاه.` 
                        }
                    );
                } catch (qrErr) {
                    console.error('خطأ في إرسال الـ QR:', qrErr);
                }
            }

            if (connection === 'open' && !connected) {
                connected = true;
                clearTimeout(timeout);
                console.log(`✅ تم الاتصال بـ WhatsApp بنجاح للحساب ${accountIndex}`);
                await ctx.reply(`✅ **تم ربط وتوصيل الحساب رقم (${accountIndex}) بنجاح!**`);
                resolve(sock);
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || '';
                
                console.log(`⚠️ انقطع الاتصال للحساب ${accountIndex} - الكود: ${statusCode}`);

                if (statusCode === 515 || errorMessage.includes('restart required')) {
                    console.log('🔄 إعادة تشغيل الاتصال تلقائياً (رمز 515)...');
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
                    reject(new Error(`تم إغلاق اتصال الحساب ${accountIndex}. الكود: ${statusCode || 'غير معروف'}`));
                }
            }
        });
    });
}

/**
 * دالة الفحص الرئيسية المتعددة الحسابات
 */
async function startMultiAccountScanner(usernamesFile, scanConfig = {}, ctx, onProgress = async () => {}, control = {}) {
    if (!fs.existsSync(usernamesFile)) {
        throw new Error('ملف usernames.txt غير موجود');
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
        throw new Error('الملف فارغ ولا يحتوي على أسماء مستخدمين');
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
            await ctx.reply('🛑 **تم إيقاف وتصفير عملية الفحص بناءً على طلبك.**');
            return;
        }

        const checkCount = i - progress.index;
        if (checkCount > 0 && checkCount % switchInterval === 0 && accountsCount > 1) {
            try { sock.ws?.close(); } catch {}
            activeAccountIndex = (activeAccountIndex % accountsCount) + 1;
            await ctx.reply(`🔄 **جاري التبديل إلى الحساب رقم (${activeAccountIndex})...**`);
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

            await ctx.reply(`⚠️ خطأ في فحص اليوزر \`${username}\`: ${errMessage}`);
            
            await sleep(5000);
            sock = await getWaSocket(activeAccountIndex, ctx);
        }
    }

    try { sock.ws?.close(); } catch {}
    await ctx.reply('🎉 **تم الانتهاء من فحص جميع اليوزرات بنجاح!**');
}

module.exports = {
    startScanner: startMultiAccountScanner,
    startMultiAccountScanner
};