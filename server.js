// ============================================
// SERVER.JS - Express Server Utama (Turso Edition)
// DKH SHOP MARKET - Marketplace Digital
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const { initDatabase, getDb } = require('./database');
const { initBot, sendOrderNotification } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Konfigurasi Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadsDir = '/tmp';
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// Multer menggunakan memoryStorage agar bisa langsung dilempar ke Cloudinary
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if (allowedTypes.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Hanya file gambar (JPG, PNG, WEBP) yang diizinkan!'));
    }
});

function generateOrderNumber() {
    return `DKH-${Math.floor(10000 + Math.random() * 90000)}`;
}

function adminAuth(req, res, next) {
    const password = req.headers['x-admin-password'];
    if (!password || password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Password admin salah' });
    }
    next();
}

// ===== API ROUTES (ASYNC) =====

app.get('/api/products', async (req, res) => {
    try {
        const db = getDb();
        const products = await db.queryAll('SELECT * FROM products WHERE is_active = 1 ORDER BY sold DESC');
        const parsed = products.map(p => ({
            ...p,
            description: JSON.parse(p.description || '[]')
        }));
        res.json({ success: true, data: parsed });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal memuat produk' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const db = getDb();
        const product = await db.queryOne('SELECT * FROM products WHERE id = ? AND is_active = 1', [parseInt(req.params.id)]);
        if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
        
        product.description = JSON.parse(product.description || '[]');
        res.json({ success: true, data: product });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal memuat produk' });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { customer_name, customer_phone, customer_email, items } = req.body;
        if (!customer_name || !customer_phone || !items || !Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });
        }

        const db = getDb();
        const id = uuidv4();
        let orderNumber = generateOrderNumber();

        while (await db.queryOne('SELECT id FROM orders WHERE order_number = ?', [orderNumber])) {
            orderNumber = generateOrderNumber();
        }

        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const product = await db.queryOne('SELECT * FROM products WHERE id = ? AND is_active = 1', [parseInt(item.product_id)]);
            if (!product) return res.status(400).json({ success: false, message: `Produk ID ${item.product_id} tidak ditemukan` });

            const qty = parseInt(item.qty) || 1;
            const subtotal = product.price * qty;
            totalAmount += subtotal;
            orderItems.push({ product_id: product.id, product_name: product.full_name, price: product.price, qty: qty, subtotal: subtotal });
        }

        const now = new Date().toISOString();
        await db.runQuery(
            `INSERT INTO orders (id, order_number, customer_name, customer_phone, customer_email, items, total_amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`,
            [id, orderNumber, customer_name, customer_phone, customer_email || '', JSON.stringify(orderItems), totalAmount, now, now]
        );

        res.json({ success: true, data: { id, order_number: orderNumber, total_amount: totalAmount, items: orderItems }, message: `Order berhasil dibuat!` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal membuat order' });
    }
});

app.get('/api/orders/:id', async (req, res) => {
    try {
        const db = getDb();
        const order = await db.queryOne('SELECT * FROM orders WHERE id = ? OR order_number = ?', [req.params.id, req.params.id]);
        if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });

        order.items = JSON.parse(order.items);
        res.json({ success: true, data: order });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal memuat order' });
    }
});

app.get('/api/orders/:id/status', async (req, res) => {
    try {
        const db = getDb();
        const order = await db.queryOne('SELECT id, order_number, status, reject_reason, created_at, updated_at FROM orders WHERE id = ? OR order_number = ?', [req.params.id, req.params.id]);
        if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });

        const statusLabels = { 'pending_payment': 'Menunggu Pembayaran', 'pending_verification': 'Menunggu Verifikasi', 'confirmed': 'Dikonfirmasi', 'rejected': 'Ditolak', 'completed': 'Selesai' };
        res.json({ success: true, data: { ...order, status_label: statusLabels[order.status] || order.status } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal memuat status' });
    }
});

// Upload bukti transfer langsung ke Cloudinary
app.post('/api/orders/:id/upload-proof', upload.single('payment_proof'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File wajib diupload!' });

        const db = getDb();
        const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        // Upload buffer ke Cloudinary menggunakan stream
        const uploadToCloudinary = (buffer) => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { folder: 'dkh_payment_proofs' },
                    (error, result) => {
                        if (result) resolve(result);
                        else reject(error);
                    }
                );
                stream.end(buffer);
            });
        };

        const cloudinaryResult = await uploadToCloudinary(req.file.buffer);
        const proofUrl = cloudinaryResult.secure_url;

        await db.runQuery(`UPDATE orders SET payment_proof = ?, status = 'pending_verification', updated_at = ? WHERE id = ?`, [proofUrl, new Date().toISOString(), req.params.id]);

        const updatedOrder = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
        
        // Simpan file sementara secara lokal khusus untuk dikirim sebagai foto ke Telegram jika diperlukan
        const tempLocalPath = path.join(uploadsDir, `proof_${Date.now()}${path.extname(req.file.originalname)}`);
        fs.writeFileSync(tempLocalPath, req.file.buffer);
        
        await sendOrderNotification(process.env.TELEGRAM_ADMIN_CHAT_ID, updatedOrder, tempLocalPath);
        
        if (fs.existsSync(tempLocalPath)) {
            fs.unlinkSync(tempLocalPath);
        }

        res.json({ success: true, data: { payment_proof: proofUrl }, message: 'Bukti berhasil diupload!' });
    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).json({ success: false, message: 'Gagal upload bukti pembayaran ke cloud' });
    }
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
    try {
        const db = getDb();
        const { status } = req.query;
        let orders = (status && status !== 'all') ? 
            await db.queryAll('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC', [status]) : 
            await db.queryAll('SELECT * FROM orders ORDER BY created_at DESC');

        res.json({ success: true, data: orders.map(o => ({ ...o, items: JSON.parse(o.items) })) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal memuat orders' });
    }
});

app.post('/api/admin/orders/:id/confirm', adminAuth, async (req, res) => {
    try {
        const db = getDb();
        const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });

        await db.runQuery(`UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?`, [new Date().toISOString(), req.params.id]);
        const items = JSON.parse(order.items);
        for (const item of items) await db.runQuery('UPDATE products SET sold = sold + ? WHERE id = ?', [item.qty, item.product_id]);

        res.json({ success: true, message: `Order dikonfirmasi!` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal konfirmasi' });
    }
});

app.post('/api/admin/orders/:id/reject', adminAuth, async (req, res) => {
    try {
        const db = getDb();
        const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });

        await db.runQuery(`UPDATE orders SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`, [req.body.reason || 'Tidak ada alasan', new Date().toISOString(), req.params.id]);
        res.json({ success: true, message: `Order ditolak.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal tolak' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
    try {
        await initDatabase();
        if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
            initBot(process.env.TELEGRAM_BOT_TOKEN);
        }
        app.listen(PORT, () => {
            console.log(`🌐 Server Berjalan di port ${PORT}`);
        });
    } catch (err) {
        console.error('❌ Gagal memulai server:', err);
    }
}
startServer();

module.exports = app;