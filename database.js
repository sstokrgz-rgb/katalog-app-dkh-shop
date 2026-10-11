// ============================================
// DATABASE.JS - Modul Database SQLite (sql.js)
// DKH SHOP MARKET - Marketplace Digital
// Pure JavaScript, tanpa native bindings
// ============================================

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'dkh_shop.db');

let db = null;
let dbReady = null; // Promise untuk inisialisasi async

// Inisialisasi database (async karena sql.js perlu load WASM)
async function initDatabase() {
    const SQL = await initSqlJs();

    // Load existing database atau buat baru
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Buat tabel
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            full_name TEXT NOT NULL,
            duration TEXT DEFAULT '1 Bulan',
            price INTEGER NOT NULL,
            sold INTEGER DEFAULT 0,
            description TEXT,
            image_url TEXT,
            category TEXT DEFAULT 'digital',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            order_number TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_email TEXT,
            items TEXT NOT NULL,
            total_amount INTEGER NOT NULL,
            status TEXT DEFAULT 'pending_payment',
            payment_proof TEXT,
            reject_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed produk jika tabel kosong
    const result = db.exec('SELECT COUNT(*) as cnt FROM products');
    const count = result[0].values[0][0];
    if (count === 0) {
        seedProducts();
    }

    saveDatabase();
    console.log('✅ Database terkoneksi');
    return db;
}

// Simpan database ke disk
function saveDatabase() {
    if (!db) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Helper: jalankan query dan return array of objects
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

// Helper: jalankan query dan return 1 object
function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

// Helper: jalankan statement tanpa return
function runQuery(sql, params = []) {
    db.run(sql, params);
    saveDatabase(); // Auto-save setelah setiap perubahan
}

// Mendapatkan instance database (pastikan sudah ready)
function getDb() {
    if (!db) throw new Error('Database belum diinisialisasi! Panggil initDatabase() dulu.');
    return { queryAll, queryOne, runQuery, raw: db };
}

// Data produk dari website asli
function seedProducts() {
    const dataProduk = [
        { nama: "Alight Motion 12 Bulan", harga: 1000, terjual: 325, deskripsi: ["tanpa watermark", "akun seller", "garansi 6 bulan"] },
        { nama: "Apple Music", harga: 5000, terjual: 85, deskripsi: ["via invite", "akun pembeli", "garansi 25 hari", "strong account"] },
        { nama: "Bstation Sharing", harga: 7000, terjual: 255, deskripsi: ["sharing", "akun seller", "garansi 25 hari"] },
        { nama: "Canva 1 Bulan", harga: 1000, terjual: 2653, deskripsi: ["via invite", "private", "garansi 20 hari", "strong account"] },
        { nama: "Canva Edu Lifetime", harga: 10000, terjual: 1964, deskripsi: ["via invite", "private", "garansi 6 bulan", "strong account"] },
        { nama: "CapCut 1 Bulan", harga: 19500, terjual: 2199, deskripsi: ["akun seller", "private", "garansi bf 25 hari", "strong account"] },
        { nama: "CapCut 1 Minggu", harga: 6500, terjual: 1700, deskripsi: ["akun seller", "private", "garansi bf 3 hari", "strong account"] },
        { nama: "ChatGPT Sharing Go", harga: 15000, terjual: 509, deskripsi: ["sharing 8 user", "akun seller", "garansi 25 hari"] },
        { nama: "Disney Sharing", harga: 15000, terjual: 50, deskripsi: ["sharing 6 user", "akun seller", "garansi 25 hari"] },
        { nama: "Duolingo 1 Minggu", harga: 3000, terjual: 25, deskripsi: ["via invite", "private", "garansi 3 hari", "strong account"] },
        { nama: "Duolingo 1 Bulan", harga: 7000, terjual: 25, deskripsi: ["via invite", "private", "garansi 25 hari", "strong account"] },
        { nama: "Gemini Pro 18 Bulan", harga: 20000, terjual: 150, deskripsi: ["invite", "private", "garansi login 24 jam", "strong account"] },
        { nama: "Getcontact", harga: 10000, terjual: 70, deskripsi: ["nomor pembeli", "private", "garansi 20 hari", "strong account"] },
        { nama: "iQIYI Standar", harga: 30000, terjual: 30, deskripsi: ["akun seller", "private", "garansi 25 hari"] },
        { nama: "Meitu 1 Minggu", harga: 8000, terjual: 38, deskripsi: ["akun seller", "private", "garansi 3 hari", "strong account"] },
        { nama: "Netflix 1U", harga: 35000, terjual: 194, deskripsi: ["akun seller", "sharing max 1 dev", "garansi 25 hari", "strong account"] },
        { nama: "Netflix Semi", harga: 38000, terjual: 233, deskripsi: ["akun seller", "sharing max 2 dev", "garansi 25 hari", "strong account"] },
        { nama: "Notion AI", harga: 8000, terjual: 75, deskripsi: ["akun seller", "private", "garansi 25 hari", "strong account"] },
        { nama: "Prime Private", harga: 15000, terjual: 41, deskripsi: ["akun seller", "bisa login 3 dev", "garansi 25 hari"] },
        { nama: "Prime Sharing", harga: 9000, terjual: 43, deskripsi: ["akun seller", "sharing 3 user", "garansi 25 hari"] },
        { nama: "Spotify", harga: 5000, terjual: 130, deskripsi: ["akun seller", "private", "garansi 24 jam", "strong account"] },
        { nama: "Vidio", harga: 13000, terjual: 40, deskripsi: ["akun seller", "khusus tv only", "garansi 24 jam", "strong account"] },
        { nama: "Viu", harga: 1000, terjual: 427, deskripsi: ["akun seller", "private", "garansi 25 hari", "strong account"] },
        { nama: "VPN HMA", harga: 13000, terjual: 50, deskripsi: ["login via code", "akun pembeli", "garansi 20 hari", "strong account"] },
        { nama: "WeTV Sharing", harga: 10000, terjual: 129, deskripsi: ["akun seller", "sharing 6 user", "garansi 25 hari"] },
        { nama: "WeTV Private", harga: 30000, terjual: 290, deskripsi: ["akun seller", "bisa login 6 dev", "garansi 25 hari", "strong account"] },
        { nama: "Wink 1 Minggu", harga: 8000, terjual: 29, deskripsi: ["akun seller", "private", "garansi 25 hari", "strong account"] },
        { nama: "YT Prem Invite", harga: 5000, terjual: 1376, deskripsi: ["via invite", "akun pembeli", "garansi 20 hari", "strong account"] },
        { nama: "Zoom 14 Hari", harga: 4000, terjual: 87, deskripsi: ["akun seller", "private", "garansi 7 hari", "strong account"] },
        { nama: "Zoom 1 Bulan", harga: 5000, terjual: 79, deskripsi: ["akun seller", "private renew 14 hari", "fullgaransi", "strong account"] }
    ];

    const getLogoUrl = (name) => {
        const n = name.toLowerCase();
        if (n.includes('apple')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://music.apple.com&size=256';
        if (n.includes('canva')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://canva.com&size=256';
        if (n.includes('capcut')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://capcut.com&size=256';
        if (n.includes('chatgpt')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://openai.com&size=256';
        if (n.includes('disney')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://disneyplus.com&size=256';
        if (n.includes('duolingo')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://duolingo.com&size=256';
        if (n.includes('gemini')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://gemini.google.com&size=256';
        if (n.includes('getcontact')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://getcontact.com&size=256';
        if (n.includes('iqiyi')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://iq.com&size=256';
        if (n.includes('netflix')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://netflix.com&size=256';
        if (n.includes('notion')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://notion.so&size=256';
        if (n.includes('prime')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://primevideo.com&size=256';
        if (n.includes('spotify')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://spotify.com&size=256';
        if (n.includes('vidio')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://vidio.com&size=256';
        if (n.includes('viu')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://viu.com&size=256';
        if (n.includes('wetv')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://wetv.vip&size=256';
        if (n.includes('yt prem') || n.includes('youtube')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://youtube.com&size=256';
        if (n.includes('zoom')) return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://zoom.us&size=256';
        if (n.includes('meitu')) return 'https://play-lh.googleusercontent.com/cshtf7MBtmCo5hOjigtUOLgpCcx-ZkQ_eisfmSvK0QZBKSG5bp4MEIH9iqdGYWnUK0B1bEc6iQ10p7WVZYVW7A';
        if (n.includes('wink')) return 'https://play-lh.googleusercontent.com/cshtf7MBtmCo5hOjigtUOLgpCcx-ZkQ_eisfmSvK0QZBKSG5bp4MEIH9iqdGYWnUK0B1bEc6iQ10p7WVZYVW7A=w1024';
        if (n.includes('alight motion')) return 'https://img.utdstc.com/icon/c97/f24/c97f2493b3b32c1b3ddec2f11baddee22e4d2e2983c1939bb6107d8e0d036d0b:600';
        if (n.includes('vpn hma')) return 'https://static2.hidemyass.com/10004980/web/i/hma-vpn-logo.png';
        if (n.includes('bstation')) return 'https://pic.bstarstatic.com/fe-activity/images/YoYvSHUSXE_w600_h600.jpg';
        return null;
    };

    const extractDuration = (fullName) => {
        const match = fullName.match(/\b(\d+\s*(Bulan|Minggu|Hari)|Lifetime)\b/i);
        return match ? match[0] : '1 Bulan';
    };

    const extractName = (fullName) => {
        return fullName.replace(/\b(\d+\s*(Bulan|Minggu|Hari)|Lifetime)\b/i, '').trim();
    };

    for (const item of dataProduk) {
        const name = extractName(item.nama);
        const duration = extractDuration(item.nama);
        const imageUrl = getLogoUrl(item.nama) || `https://placehold.co/400x300/4f46e5/ffffff?text=${encodeURIComponent(name)}&font=montserrat`;

        db.run(
            `INSERT INTO products (name, full_name, duration, price, sold, description, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, item.nama, duration, item.harga, item.terjual, JSON.stringify(item.deskripsi), imageUrl]
        );
    }

    saveDatabase();
    console.log(`✅ Database di-seed dengan ${dataProduk.length} produk`);
}

// Export
module.exports = { initDatabase, getDb };
