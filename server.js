// ============================================
// SERVER.JS - Express Server Utama
// DKH SHOP MARKET - Marketplace Digital
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, getDb } = require('./database');
const { initBot, sendOrderNotification } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gunakan folder /tmp karena Vercel bersifat Read-Only
const uploadsDir = '/tmp';
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files (mengarah ke /tmp)
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi Multer untuk upload file
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueName = `proof_${Date.now()}_${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Max 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar (JPG, PNG, WEBP) yang diizinkan!'));
        }
    }
});

// Format Rupiah
function formatRupiah(angka) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency', currency: 'IDR', minimumFractionDigits: 0
    }).format(angka);
}

// Generate nomor order DKH-XXXXX
function generateOrderNumber() {
    const num = Math.floor(10000 + Math.random() * 90000);
    return `DKH-${num}`;
}

// Middleware autentikasi admin
function adminAuth(req, res, next) {
    const password = req.headers['x-admin-password'];
    if (!password || password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: 'Password admin salah atau tidak diberikan'
        });
    }
    next();
}

// ===== API ROUTES: PRODUK =====

// GET semua produk
app.get('/api/products', (req, res) => {
    try {
        const db = getDb();
        const products = db.queryAll('SELECT * FROM products WHERE is_active = 1 ORDER BY sold DESC');

        const parsed = products.map(p => ({
            ...p,
            description: JSON.parse(p.description || '[]')
        }));

        res.json({ success: true, data: parsed });
    } catch (err) {
        console.error('Error get products:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat produk' });
    }
});

// GET produk by ID
app.get('/api/products/:id', (req, res) => {
    try {
        const db = getDb();
        const product = db.queryOne('SELECT * FROM products WHERE id = ? AND is_active = 1', [parseInt(req.params.id)]);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
        }

        product.description = JSON.parse(product.description || '[]');
        res.json({ success: true, data: product });
    } catch (err) {
        console.error('Error get product:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat produk' });
    }
});

// ===== API ROUTES: ORDER =====

// POST buat order baru
app.post('/api/orders', (req, res) => {
    try {
        const { customer_name, customer_phone, customer_email, items } = req.body;

        if (!customer_name || !customer_phone || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Data tidak lengkap. Wajib: customer_name, customer_phone, items[]'
            });
        }

        const db = getDb();
        const id = uuidv4();
        let orderNumber = generateOrderNumber();

        // Pastikan order number unik
        while (db.queryOne('SELECT id FROM orders WHERE order_number = ?', [orderNumber])) {
            orderNumber = generateOrderNumber();
        }

        // Hitung total dan validasi produk
        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const product = db.queryOne('SELECT * FROM products WHERE id = ? AND is_active = 1', [parseInt(item.product_id)]);
            if (!product) {
                return res.status(400).json({
                    success: false,
                    message: `Produk dengan ID ${item.product_id} tidak ditemukan`
                });
            }

            const qty = parseInt(item.qty) || 1;
            const subtotal = product.price * qty;
            totalAmount += subtotal;

            orderItems.push({
                product_id: product.id,
                product_name: product.full_name,
                price: product.price,
                qty: qty,
                subtotal: subtotal
            });
        }

        const now = new Date().toISOString();

        // Simpan order
        db.runQuery(
            `INSERT INTO orders (id, order_number, customer_name, customer_phone, customer_email, items, total_amount, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`,
            [id, orderNumber, customer_name, customer_phone, customer_email || '', JSON.stringify(orderItems), totalAmount, now, now]
        );

        res.json({
            success: true,
            data: {
                id,
                order_number: orderNumber,
                total_amount: totalAmount,
                items: orderItems
            },
            message: `Order ${orderNumber} berhasil dibuat! Silakan upload bukti transfer.`
        });

    } catch (err) {
        console.error('Error create order:', err);
        res.status(500).json({ success: false, message: 'Gagal membuat order' });
    }
});

// GET order by ID atau order_number
app.get('/api/orders/:id', (req, res) => {
    try {
        const db = getDb();
        const order = db.queryOne('SELECT * FROM orders WHERE id = ? OR order_number = ?', [req.params.id, req.params.id]);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        order.items = JSON.parse(order.items);
        res.json({ success: true, data: order });
    } catch (err) {
        console.error('Error get order:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat order' });
    }
});

// GET status order
app.get('/api/orders/:id/status', (req, res) => {
    try {
        const db = getDb();
        const order = db.queryOne(
            'SELECT id, order_number, status, reject_reason, created_at, updated_at FROM orders WHERE id = ? OR order_number = ?',
            [req.params.id, req.params.id]
        );

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        const statusLabels = {
            'pending_payment': 'Menunggu Pembayaran',
            'pending_verification': 'Menunggu Verifikasi',
            'confirmed': 'Dikonfirmasi',
            'rejected': 'Ditolak',
            'completed': 'Selesai'
        };

        res.json({
            success: true,
            data: {
                ...order,
                status_label: statusLabels[order.status] || order.status
            }
        });
    } catch (err) {
        console.error('Error get order status:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat status order' });
    }
});

// POST upload bukti transfer
app.post('/api/orders/:id/upload-proof', upload.single('payment_proof'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File bukti transfer wajib diupload!' });
        }

        const db = getDb();
        const order = db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);

        if (!order) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        const proofPath = `/uploads/${req.file.filename}`;
        const now = new Date().toISOString();

        db.runQuery(
            `UPDATE orders SET payment_proof = ?, status = 'pending_verification', updated_at = ? WHERE id = ?`,
            [proofPath, now, req.params.id]
        );

        // Kirim notifikasi ke Telegram (Update ke folder /tmp)
        const updatedOrder = db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
        const fullImagePath = path.join(uploadsDir, req.file.filename);

        await sendOrderNotification(
            process.env.TELEGRAM_ADMIN_CHAT_ID,
            updatedOrder,
            fullImagePath
        );

        res.json({
            success: true,
            data: { payment_proof: proofPath },
            message: 'Bukti transfer berhasil diupload! Pesanan sedang diverifikasi.'
        });

    } catch (err) {
        console.error('Error upload proof:', err);
        res.status(500).json({ success: false, message: 'Gagal upload bukti transfer' });
    }
});

// ===== API ROUTES: ADMIN =====

// GET semua order (admin)
app.get('/api/admin/orders', adminAuth, (req, res) => {
    try {
        const db = getDb();
        const { status } = req.query;

        let orders;
        if (status && status !== 'all') {
            orders = db.queryAll('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC', [status]);
        } else {
            orders = db.queryAll('SELECT * FROM orders ORDER BY created_at DESC');
        }

        const parsed = orders.map(o => ({
            ...o,
            items: JSON.parse(o.items)
        }));

        res.json({ success: true, data: parsed });
    } catch (err) {
        console.error('Error admin get orders:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat orders' });
    }
});

// POST konfirmasi order (admin)
app.post('/api/admin/orders/:id/confirm', adminAuth, (req, res) => {
    try {
        const db = getDb();
        const order = db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        if (order.status === 'confirmed') {
            return res.status(400).json({ success: false, message: 'Order sudah dikonfirmasi' });
        }

        const now = new Date().toISOString();
        db.runQuery(`UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?`, [now, req.params.id]);

        // Update sold count
        const items = JSON.parse(order.items);
        for (const item of items) {
            db.runQuery('UPDATE products SET sold = sold + ? WHERE id = ?', [item.qty, item.product_id]);
        }

        res.json({
            success: true,
            message: `Order ${order.order_number} berhasil dikonfirmasi!`
        });
    } catch (err) {
        console.error('Error confirm order:', err);
        res.status(500).json({ success: false, message: 'Gagal konfirmasi order' });
    }
});

// POST tolak order (admin)
app.post('/api/admin/orders/:id/reject', adminAuth, (req, res) => {
    try {
        const db = getDb();
        const { reason } = req.body;
        const order = db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        if (order.status === 'rejected') {
            return res.status(400).json({ success: false, message: 'Order sudah ditolak' });
        }

        const now = new Date().toISOString();
        db.runQuery(
            `UPDATE orders SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`,
            [reason || 'Tidak ada alasan', now, req.params.id]
        );

        res.json({
            success: true,
            message: `Order ${order.order_number} ditolak.`
        });
    } catch (err) {
        console.error('Error reject order:', err);
        res.status(500).json({ success: false, message: 'Gagal menolak order' });
    }
});

// ===== FALLBACK ROUTE =====
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== START SERVER =====
async function startServer() {
    try {
        // Inisialisasi database (async karena sql.js)
        await initDatabase();

        // Inisialisasi Telegram Bot
        initBot(process.env.TELEGRAM_BOT_TOKEN);

        app.listen(PORT, () => {
            console.log('');
            console.log('╔══════════════════════════════════════════╗');
            console.log('║    🛒 DKH SHOP MARKET - Server           ║');
            console.log('╠══════════════════════════════════════════╣');
            console.log(`║  🌐 http://localhost:${PORT}               ║`);
            console.log(`║  📊 Admin: http://localhost:${PORT}/admin.html  ║`);
            console.log('╚══════════════════════════════════════════╝');
            console.log('');
        });
    } catch (err) {
        console.error('❌ Gagal memulai server:', err);
        process.exit(1);
    }
}

startServer();

// ===== EXPORT UNTUK VERCEL =====
module.exports = app;