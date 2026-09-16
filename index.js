const { startMultiAccountScanner } = require('./scanner');

async function main() {
  try {
    console.log('جاري تشغيل البوت...');
    await startMultiAccountScanner();
  } catch (error) {
    console.error('خطأ:', error.message);
  }
}

main();