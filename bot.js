// ============================================
// BOT.JS - Skrip Khusus Bot Telegram 24/7
// DKH SHOP MARKET
// ============================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN belum diatur di environment variables!');
    process.exit(1);
}

// Inisialisasi bot dengan polling aktif (stabil karena berjalan terpisah dari Vercel)
const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Bot Telegram 24/7 aktif dan siap mendengarkan...');

bot.on('polling_error', (error) => {
    // Mengabaikan error konflik ringan
});

// Fungsi untuk menerima perintah luar atau webhook jika diperlukan
// Saat ini bot fokus mengirim notifikasi instan
module.exports = { bot };