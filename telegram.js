// ============================================
// TELEGRAM.JS - Modul Telegram Bot
// DKH SHOP MARKET - Notifikasi & Approval
// ============================================

const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./database');

let bot = null;

// Format mata uang Rupiah
function formatRupiah(angka) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(angka);
}

// Inisialisasi Bot Telegram
function initBot(token) {
    if (!token || token === 'YOUR_BOT_TOKEN_HERE') {
        console.log('⚠️  Telegram Bot Token belum diisi. Bot tidak aktif.');
        console.log('   Silakan isi TELEGRAM_BOT_TOKEN di file .env');
        return null;
    }

    try {
        bot = new TelegramBot(token, { polling: true });

        bot.on('polling_error', (error) => {
            console.error('❌ Telegram polling error:', error.message);
        });

        // Handle callback query (tombol approve/reject)
        bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;
            const messageId = callbackQuery.message.message_id;

            try {
                if (data.startsWith('approve_')) {
                    const orderId = data.replace('approve_', '');
                    await handleApprove(chatId, messageId, orderId);
                } else if (data.startsWith('reject_')) {
                    const orderId = data.replace('reject_', '');
                    await handleRejectPrompt(chatId, messageId, orderId);
                }

                bot.answerCallbackQuery(callbackQuery.id);
            } catch (err) {
                console.error('Error handling callback:', err);
                bot.answerCallbackQuery(callbackQuery.id, { text: 'Terjadi error!' });
            }
        });

        // Handle pesan teks untuk alasan reject
        bot.on('message', (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;

            // Cek apakah ada pending reject
            if (pendingRejects[chatId] && text && !text.startsWith('/')) {
                const orderId = pendingRejects[chatId];
                delete pendingRejects[chatId];
                handleReject(chatId, orderId, text);
            }
        });

        console.log('✅ Telegram Bot aktif dan siap menerima perintah');
        return bot;
    } catch (err) {
        console.error('❌ Gagal inisialisasi Telegram Bot:', err.message);
        return null;
    }
}

// Simpan pending reject untuk menunggu alasan
const pendingRejects = {};

// Kirim notifikasi order baru ke admin
async function sendOrderNotification(adminChatId, order, paymentProofPath) {
    if (!bot || !adminChatId) {
        console.log('⚠️  Bot tidak aktif, notifikasi tidak dikirim');
        return;
    }

    try {
        const items = JSON.parse(order.items);
        const itemList = items.map((item, i) =>
            `  ${i + 1}. ${item.product_name} x${item.qty} = ${formatRupiah(item.subtotal)}`
        ).join('\n');

        const message = `
🛒 *PESANAN BARU!*

📋 *Order:* \`${order.order_number}\`
👤 *Nama:* ${order.customer_name}
📱 *WhatsApp:* ${order.customer_phone}
📧 *Email:* ${order.customer_email || '-'}

🛍️ *Produk:*
${itemList}

💰 *Total:* *${formatRupiah(order.total_amount)}*
📅 *Waktu:* ${new Date(order.created_at).toLocaleString('id-ID')}

📸 *Bukti Transfer:* Terlampir di bawah
        `.trim();

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ APPROVE', callback_data: `approve_${order.id}` },
                    { text: '❌ REJECT', callback_data: `reject_${order.id}` }
                ]
            ]
        };

        // Kirim foto bukti transfer + pesan
        if (paymentProofPath && fs.existsSync(paymentProofPath)) {
            await bot.sendPhoto(adminChatId, paymentProofPath, {
                caption: message,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            // Kirim pesan tanpa foto
            await bot.sendMessage(adminChatId, message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }

        console.log(`📤 Notifikasi order ${order.order_number} terkirim ke Telegram`);
    } catch (err) {
        console.error('❌ Gagal kirim notifikasi Telegram:', err.message);
    }
}

// Handle approve order
async function handleApprove(chatId, messageId, orderId) {
    const db = getDb();

    const order = db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
        bot.sendMessage(chatId, '❌ Order tidak ditemukan!');
        return;
    }

    if (order.status === 'confirmed') {
        bot.sendMessage(chatId, '⚠️ Order ini sudah dikonfirmasi sebelumnya.');
        return;
    }

    const now = new Date().toISOString();

    // Update status order
    db.runQuery(`UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?`, [now, orderId]);

    // Update sold count
    const items = JSON.parse(order.items);
    for (const item of items) {
        db.runQuery('UPDATE products SET sold = sold + ? WHERE id = ?', [item.qty, item.product_id]);
    }

    // Edit pesan di Telegram
    const successMsg = `
✅ *ORDER DIKONFIRMASI*

📋 *Order:* \`${order.order_number}\`
👤 *Nama:* ${order.customer_name}
📱 *WA:* ${order.customer_phone}
💰 *Total:* ${formatRupiah(order.total_amount)}

Status: ✅ DIKONFIRMASI
Waktu: ${new Date().toLocaleString('id-ID')}
    `.trim();

    try {
        await bot.editMessageCaption(successMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
    } catch {
        await bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' });
    }
}

// Handle reject prompt (minta alasan)
async function handleRejectPrompt(chatId, messageId, orderId) {
    pendingRejects[chatId] = orderId;

    await bot.sendMessage(chatId,
        `❌ *Tolak Order*\n\nSilakan ketik alasan penolakan untuk order ini:`,
        { parse_mode: 'Markdown' }
    );
}

// Handle reject order dengan alasan
async function handleReject(chatId, orderId, reason) {
    const db = getDb();

    const order = db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
        bot.sendMessage(chatId, '❌ Order tidak ditemukan!');
        return;
    }

    const now = new Date().toISOString();

    // Update status order
    db.runQuery(
        `UPDATE orders SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`,
        [reason, now, orderId]
    );

    const rejectMsg = `
❌ *ORDER DITOLAK*

📋 *Order:* \`${order.order_number}\`
👤 *Nama:* ${order.customer_name}
📱 *WA:* ${order.customer_phone}
💰 *Total:* ${formatRupiah(order.total_amount)}

📝 *Alasan:* ${reason}

Status: ❌ DITOLAK
Waktu: ${new Date().toLocaleString('id-ID')}
    `.trim();

    await bot.sendMessage(chatId, rejectMsg, { parse_mode: 'Markdown' });
}

module.exports = { initBot, sendOrderNotification };
