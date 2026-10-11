// ============================================
// BOT.JS - Skrip Khusus Bot Telegram 24/7 (Render Compatible)
// DKH SHOP MARKET
// ============================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Buat endpoint HTTP sederhana agar Render mendeteksi port aktif
app.get('/', (req, res) => {
    res.send('DKH Shop Telegram Bot is running smoothly!');
});

app.listen(PORT, () => {
    console.log(`🌐 HTTP Server berjalan di port ${PORT} untuk Render health check.`);
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN belum diatur di environment variables!');
    process.exit(1);
}

// Inisialisasi bot dengan polling aktif
const bot = new TelegramBot(token, { polling: true });

console.log('🤖 Bot Telegram 24/7 aktif dan siap mendengarkan...');

bot.on('polling_error', (error) => {
    // Mengabaikan error konflik ringan
});

module.exports = { bot };