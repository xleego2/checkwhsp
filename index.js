const crypto = require("crypto");
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto || crypto;
console.log("جاري تشغيل البوت...");

process.on('uncaughtException', (err) => {
    console.error('حدث خطأ غير متوقع:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('تحذير: خطأ غير معالج داخل السكريبت:', reason);
});

const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { startMultiAccountScanner } = require('./scanner');

const BOT_TOKEN = process.env.BOT_TOKEN || '1970520551:AAFFcFAD849_MkieOmmEInznS5eh5KWdp_M';
const bot = new Telegraf(BOT_TOKEN);

const USERNAMES_FILE = './usernames.txt';
const METADATA_FILE = './file_info.json';
const PROGRESS_FILE = './progress.json';
const AVAILABLE_FILE = './results/available.txt';

let scannerControl = { isPaused: false, isCancelled: false };
let isRunning = false;

let scanConfig = {
    accountsCount: 1,
    delayMs: 5000,
    switchInterval: 100
};

let liveStats = { current: 0, total: 0, lastUsername: '-', availableCount: 0, status: 'متوقف ⚪', activeAccount: 1 };

// ترتيب الأزرار الجديدة
const mainKeyboard = Markup.keyboard([
    ['▶️ بدء الفحص', '⏸️ إيقاف مؤقت / استئناف'],
    ['🛑 إيقاف الفحص', '🧹 تصفير العداد (من جديد)'],
    ['📊 حالة الفحص', '📥 تحميل المتاحة'],
    ['➕ إضافة يوزرات', '⚙️ إعدادات الفحص']
]).resize();

async function getLastFileInfo() {
    if (fs.existsSync(METADATA_FILE) && fs.existsSync(USERNAMES_FILE)) {
        try {
            return JSON.parse(await fsPromises.readFile(METADATA_FILE, 'utf8'));
        } catch {}
    }
    return null;
}

bot.start(async (ctx) => {
    await ctx.reply(
        '👋 **أهلاً بك في بوت فحص يوزرات WhatsApp المتقدم والتحكم الكامل عبر التيليجرام!**\n\n' +
        'قم برفع ملف اليوزرات، ضبط الإعدادات، ثم اضغط بدء الفحص.',
        { parse_mode: 'Markdown', ...mainKeyboard }
    );
});

bot.hears('⚙️ إعدادات الفحص', async (ctx) => {
    if (isRunning) return ctx.reply('⚠️ لا يمكنك تعديل الإعدادات أثناء تشغيل الفحص!');
    await ctx.reply(
        `⚙️ **إعدادات الفحص الحالية:**\n\n` +
        `👥 **عدد الحسابات المربوطة:** \`${scanConfig.accountsCount}\`\n` +
        `⏱️ **الفاصل الزمني:** \`${scanConfig.delayMs / 1000} ثانية\` (\`${scanConfig.delayMs}ms\`)\n` +
        `🔄 **التبديل بين الحسابات:** كل \`${scanConfig.switchInterval}\` يوزر\n\n` +
        `اختر الخيار الذي تريد تعديله:`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('👥 عدد الحسابات', 'cfg_acc')],
                [Markup.button.callback('⏱️ الفاصل الزمني (السرعة)', 'cfg_delay')],
                [Markup.button.callback('🔄 معدل التبديل (كل X يوزر)', 'cfg_switch')]
            ])
        }
    );
});

bot.action('cfg_acc', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        `👥 **حدد عدد الحسابات المفعلة (1 إلى 5):**`,
        Markup.inlineKeyboard([
            [
                Markup.button.callback('1 👤', 'set_acc_1'),
                Markup.button.callback('2 👥', 'set_acc_2'),
                Markup.button.callback('3 👥', 'set_acc_3'),
                Markup.button.callback('4 👥', 'set_acc_4'),
                Markup.button.callback('5 👥', 'set_acc_5')
            ],
            [Markup.button.callback('🔙 عودة للإعدادات', 'back_to_cfg')]
        ])
    );
});

for (let i = 1; i <= 5; i++) {
    bot.action(`set_acc_${i}`, async (ctx) => {
        scanConfig.accountsCount = i;
        await ctx.answerCbQuery(`تم اختيار ${i} حسابات`);
        await ctx.editMessageText(
            `✅ **تم ضبط عدد الحسابات على:** \`${i}\`\n\nملاحظة: عند بدء الفحص، سيطلب منك البوت تسجيل الدخول لكل حساب تباعاً عبر إرسال QR Code هنا.`, 
            { parse_mode: 'Markdown' }
        );
    });
}

bot.action('cfg_delay', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        `⏱️ **حدد الفاصل الزمني بين كل فحص يوزر وآخر:**`,
        Markup.inlineKeyboard([
            [Markup.button.callback('0.1 ثانية', 'set_delay_100'), Markup.button.callback('1 ثانية', 'set_delay_1000')],
            [Markup.button.callback('3 ثانية', 'set_delay_3000'), Markup.button.callback('5 ثانية (افتراضي)', 'set_delay_5000')],
            [Markup.button.callback('6 ثانية', 'set_delay_6000'), Markup.button.callback('8 ثانية', 'set_delay_8000')],
            [Markup.button.callback('🔙 عودة للإعدادات', 'back_to_cfg')]
        ])
    );
});

const delays = { '100': 0.1, '1000': 1, '3000': 3, '5000': 5, '6000': 6, '8000': 8 };
Object.keys(delays).forEach(d => {
    bot.action(`set_delay_${d}`, async (ctx) => {
        scanConfig.delayMs = parseInt(d);
        await ctx.answerCbQuery(`تم التحديد: ${delays[d]} ثانية`);
        await ctx.editMessageText(`✅ **تم ضبط الفاصل الزمني إلى:** \`${delays[d]} ثانية\``, { parse_mode: 'Markdown' });
    });
});

bot.action('cfg_switch', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        `🔄 **اختر متى يتم التبديل إلى الحساب التالي:**`,
        Markup.inlineKeyboard([
            [Markup.button.callback('كل 1 يوزر', 'set_sw_1'), Markup.button.callback('كل 25 يوزر', 'set_sw_25')],
            [Markup.button.callback('كل 50 يوزر', 'set_sw_50'), Markup.button.callback('كل 100 يوزر (افتراضي)', 'set_sw_100')],
            [Markup.button.callback('كل 150 يوزر', 'set_sw_150'), Markup.button.callback('كل 200 يوزر', 'set_sw_200')],
            [Markup.button.callback('كل 300 يوزر', 'set_sw_300')],
            [Markup.button.callback('🔙 عودة للإعدادات', 'back_to_cfg')]
        ])
    );
});

[1, 25, 50, 100, 150, 200, 300].forEach(sw => {
    bot.action(`set_sw_${sw}`, async (ctx) => {
        scanConfig.switchInterval = sw;
        await ctx.answerCbQuery(`التبديل كل ${sw} يوزر`);
        await ctx.editMessageText(`✅ **سيتم التبديل بين الحسابات بعد كل:** \`${sw} يوزر\``, { parse_mode: 'Markdown' });
    });
});

bot.action('back_to_cfg', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
        `⚙️ **إعدادات الفحص الحالية:**\n\n` +
        `👥 **عدد الحسابات:** \`${scanConfig.accountsCount}\`\n` +
        `⏱️ **الفاصل الزمني:** \`${scanConfig.delayMs / 1000} ثانية\`\n` +
        `🔄 **التبديل بين الحسابات:** كل \`${scanConfig.switchInterval}\` يوزر`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('👥 عدد الحسابات', 'cfg_acc')],
                [Markup.button.callback('⏱️ الفاصل الزمني', 'cfg_delay')],
                [Markup.button.callback('🔄 معدل التبديل', 'cfg_switch')]
            ])
        }
    );
});

bot.hears('➕ إضافة يوزرات', async (ctx) => {
    await ctx.reply('📁 **أرسل ملف النص (.txt) الذي يحتوي على اليوزرات الآن:**', { parse_mode: 'Markdown' });
});

bot.on('document', async (ctx) => {
    const document = ctx.message.document;
    if (!document.file_name.endsWith('.txt')) {
        return ctx.reply('❌ يرجى إرسال ملف .txt فقط!');
    }

    try {
        const fileLink = await ctx.telegram.getFileLink(document.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        
        await fsPromises.writeFile(USERNAMES_FILE, response.data);

        const textContent = response.data.toString('utf8');
        const count = textContent.split(/\r?\n/).map(x => x.trim()).filter(Boolean).length;

        const fileMeta = {
            fileName: document.file_name,
            count: count,
            uploadedAt: new Date().toLocaleString('ar-EG')
        };

        await fsPromises.writeFile(METADATA_FILE, JSON.stringify(fileMeta, null, 2));

        await ctx.reply(
            `✅ **تم حفظ ملف اليوزرات بنجاح!**\n\n` +
            `📄 **اسم الملف:** \`${fileMeta.fileName}\`\n` +
            `🔢 **عدد اليوزرات:** \`${fileMeta.count}\`\n\n` +
            `اضغط **▶️ بدء الفحص** للانطلاق.`,
            { parse_mode: 'Markdown', ...mainKeyboard }
        );
    } catch (err) {
        await ctx.reply('❌ حدث خطأ أثناء حفظ الملف.');
    }
});

bot.hears('▶️ بدء الفحص', async (ctx) => {
    if (isRunning) return ctx.reply('⚠️ الفحص يعمل بالفعل!');

    const lastFile = await getLastFileInfo();
    if (!lastFile) {
        return ctx.reply('⚠️ **لا يوجد ملف يوزرات محفوظ!** يرجى إرسال ملف نصي (.txt) أولاً.');
    }

    runScannerTask(ctx);
});

// زر الإيقاف المؤقت واستئناف الفحص
bot.hears('⏸️ إيقاف مؤقت / استئناف', async (ctx) => {
    if (!isRunning) return ctx.reply('⚠️ البوت غير شغال حالياً.');
    
    scannerControl.isPaused = !scannerControl.isPaused;
    const stateMsg = scannerControl.isPaused ? '⏸️ **تم إيقاف الفحص مؤقتاً.**' : '▶️ **تم استئناف الفحص بنجاح!**';
    liveStats.status = scannerControl.isPaused ? 'متوقف مؤقتاً 🟡' : 'شغال 🟢';
    await ctx.reply(stateMsg, { parse_mode: 'Markdown' });
});

// زر إيقاف الفحص نهائياً
bot.hears('🛑 إيقاف الفحص', async (ctx) => {
    if (!isRunning) {
        return ctx.reply('⚠️ الفحص متوقف بالفعل.');
    }
    scannerControl.isCancelled = true;
    scannerControl.isPaused = false;
    liveStats.status = 'متوقف ⚪';
    await ctx.reply('🛑 **تم إرسال أمر إيقاف الفحص. سيتم التوقف خلال لحظات...**');
});

// زر تصفير العداد للبدء من جديد من الصفر
bot.hears('🧹 تصفير العداد (من جديد)', async (ctx) => {
    if (isRunning) {
        return ctx.reply('⚠️ يرجى إيقاف الفحص أولاً قبل تصفير العداد!');
    }
    
    if (fs.existsSync(PROGRESS_FILE)) await fsPromises.unlink(PROGRESS_FILE);
    if (fs.existsSync(METADATA_FILE)) await fsPromises.unlink(METADATA_FILE);
    
    liveStats = { current: 0, total: 0, lastUsername: '-', availableCount: 0, status: 'متوقف ⚪', activeAccount: 1 };
    await ctx.reply('🧹 **تم تصفير العداد وملف التقدم بنجاح!**\n\nيمكنك الآن إرسال ملف جديد أو الضغط على (بدء الفحص) ليبدأ من الصفر تماماً.');
});

bot.hears('📊 حالة الفحص', async (ctx) => {
    const percentage = liveStats.total > 0 ? ((liveStats.current / liveStats.total) * 100).toFixed(1) : 0;
    await ctx.reply(
        `📊 **الحالة الفورية:**\n\n` +
        `🔄 **الحالة:** \`${liveStats.status}\`\n` +
        `📱 **الحساب النشط الآن:** رقم \`${liveStats.activeAccount}\`\n` +
        `👤 **آخر يوزر فُحص:** \`${liveStats.lastUsername}\`\n` +
        `📈 **التقدم:** \`${liveStats.current}\` / \`${liveStats.total}\` (\`${percentage}%\`)\n` +
        `✨ **المتاحة المكتشفة:** \`${liveStats.availableCount}\``,
        { parse_mode: 'Markdown' }
    );
});

bot.hears('📥 تحميل المتاحة', async (ctx) => {
    if (!fs.existsSync(AVAILABLE_FILE) || fs.readFileSync(AVAILABLE_FILE, 'utf8').trim() === '') {
        return ctx.reply('ℹ️ لا يوجد يوزرات متاحة مسجلة حتى الآن.');
    }
    await ctx.replyWithDocument({ source: AVAILABLE_FILE, filename: 'available.txt' });
});

async function runScannerTask(ctx) {
    if (isRunning) return;
    isRunning = true;
    scannerControl.isCancelled = false;
    scannerControl.isPaused = false;
    liveStats.status = 'شغال 🟢';

    try {
        await ctx.reply(
            `🚀 **جاري بدء عملية الفحص وتحضير الجلسات...**\n` +
            `👥 عدد الحسابات المطلوبة: \`${scanConfig.accountsCount}\`\n` +
            `ℹ️ *ملاحظة:* إذا كان أي حساب بحاجة لتسجيل الدخول، سيظهر الباركود الخاص به هنا تلقائياً.`,
            { parse_mode: 'Markdown' }
        );

        await startMultiAccountScanner(USERNAMES_FILE, scanConfig, ctx, async (update) => {
            liveStats.current = update.current;
            liveStats.total = update.total;
            liveStats.lastUsername = update.username || liveStats.lastUsername;
            liveStats.availableCount = update.availableCount;
            liveStats.activeAccount = update.activeAccount || 1;

            if (update.type === 'progress' && update.available) {
                await ctx.reply(
                    `🎯 **تم إيجاد يوزر متاح!**\n\n` +
                    `✨ **اليوزر:** \`${update.username}\`\n` +
                    `🔗 **رابط الحجز المباشر:** https://wa.me/qr/${update.username}\n` +
                    `📊 **الترتيب:** ${update.current}/${update.total}`,
                    { parse_mode: 'Markdown' }
                );
            }
        }, scannerControl);

    } catch (err) {
        console.error('خطأ:', err.message);
        await ctx.reply(`⚠️ **توقف الفحص بسبب خطأ:** ${err.message}`);
    } finally {
        isRunning = false;
        liveStats.status = 'متوقف ⚪';
    }
}

bot.catch((err, ctx) => {
    console.error(`خطأ في Telegraf (${ctx.updateType}):`, err);
});

bot.launch().then(() => {
    console.log('🤖 البوت يعمل بكامل القدرة ومستمر في الاستماع للأوامر...');
}).catch((err) => {
    console.error('فشل تشغيل البوت:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));