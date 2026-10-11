// ============================================
// TELEGRAM.JS - Modul Telegram Bot (Turso Edition)
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
        return null;
    }

    try {
        bot = new TelegramBot(token, { polling: true });

        bot.on('polling_error', (error) => {
            console.error('❌ Telegram polling error:', error.message);
        });

        // Handle callback query (tombol approve/reject menggunakan order_number)
        bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;
            const messageId = callbackQuery.message.message_id;

            try {
                if (data.startsWith('approve_')) {
                    const orderNumber = data.replace('approve_', '');
                    await handleApprove(chatId, messageId, orderNumber);
                } else if (data.startsWith('reject_')) {
                    const orderNumber = data.replace('reject_', '');
                    await handleRejectPrompt(chatId, messageId, orderNumber);
                }

                bot.answerCallbackQuery(callbackQuery.id);
            } catch (err) {
                console.error('Error handling callback:', err);
                bot.answerCallbackQuery(callbackQuery.id, { text: 'Terjadi error!' });
            }
        });

        // Handle pesan teks untuk alasan reject
        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;

            if (pendingRejects[chatId] && text && !text.startsWith('/')) {
                const orderNumber = pendingRejects[chatId];
                delete pendingRejects[chatId];
                await handleReject(chatId, orderNumber, text);
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
    if (!bot || !adminChatId) return;

    try {
        const items = JSON.parse(order.items);
        const itemList = items.map((item, i) =>
            `   ${i + 1}. ${item.product_name} x${item.qty} = ${formatRupiah(item.subtotal)}`
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

        // Tombol menggunakan order_number agar langsung cocok dengan database
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ APPROVE', callback_data: `approve_${order.order_number}` },
                    { text: '❌ REJECT', callback_data: `reject_${order.order_number}` }
                ]
            ]
        };

        if (paymentProofPath && fs.existsSync(paymentProofPath)) {
            await bot.sendPhoto(adminChatId, paymentProofPath, {
                caption: message,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
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

// Handle approve order berdasarkan order_number via raw Turso execute
async function handleApprove(chatId, messageId, orderNumber) {
    const db = getDb();

    const result = await db.raw.execute({
        sql: 'SELECT * FROM orders WHERE order_number = ?',
        args: [orderNumber]
    });

    const order = result.rows.length > 0 ? result.rows[0] : null;
    if (!order) {
        await bot.sendMessage(chatId, `❌ Order ${orderNumber} tidak ditemukan di database!`);
        return;
    }

    if (order.status === 'confirmed') {
        await bot.sendMessage(chatId, '⚠️ Order ini sudah dikonfirmasi sebelumnya.');
        return;
    }

    const now = new Date().toISOString();

    // Update status order berdasarkan id unik asli
    await db.raw.execute({
        sql: `UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?`,
        args: [now, order.id]
    });

    // Update jumlah terjual produk
    const items = JSON.parse(order.items);
    for (const item of items) {
        await db.raw.execute({
            sql: 'UPDATE products SET sold = sold + ? WHERE id = ?',
            args: [item.qty, item.product_id]
        });
    }

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
async function handleRejectPrompt(chatId, messageId, orderNumber) {
    pendingRejects[chatId] = orderNumber;
    await bot.sendMessage(chatId, `❌ *Tolak Order (${orderNumber})*\n\nSilakan ketik alasan penolakan untuk order ini:`, { parse_mode: 'Markdown' });
}

// Handle reject order dengan alasan berdasarkan order_number via raw Turso execute
async function handleReject(chatId, orderNumber, reason) {
    const db = getDb();

    const result = await db.raw.execute({
        sql: 'SELECT * FROM orders WHERE order_number = ?',
        args: [orderNumber]
    });

    const order = result.rows.length > 0 ? result.rows[0] : null;
    if (!order) {
        await bot.sendMessage(chatId, `❌ Order ${orderNumber} tidak ditemukan di database!`);
        return;
    }

    const now = new Date().toISOString();

    await db.raw.execute({
        sql: `UPDATE orders SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`,
        args: [reason, now, order.id]
    });

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