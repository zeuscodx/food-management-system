import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'food_management.db');
const distDir = path.join(rootDir, 'dist');

fs.mkdirSync(dataDir, { recursive: true });

const app = express();
const db = new sqlite3.Database(dbPath);
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET environment variable must contain at least 32 characters.');
}

function nowIso() {
  return new Date().toISOString();
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function logActivity(action, details, userId = 1) {
  await run(
    'INSERT INTO activity_log (action, details, user_id, created_at) VALUES (?, ?, ?, ?)',
    [action, details, userId, nowIso()],
  );
}

function sanitizeNumber(value, fallback = 0) {
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : fallback;
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Employee',
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS centers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      sector_id INTEGER REFERENCES sectors(id),
      people_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);

  const centerColumns = await all('PRAGMA table_info(centers)');
  if (!centerColumns.some((column) => column.name === 'sector_id')) {
    await run('ALTER TABLE centers ADD COLUMN sector_id INTEGER REFERENCES sectors(id)');
  }

  let defaultSector = await get('SELECT * FROM sectors WHERE code = ?', ['S001']);
  if (!defaultSector) {
    const result = await run(
      'INSERT INTO sectors (name, code, notes, status) VALUES (?, ?, ?, ?)',
      ['قطاع المدينة', 'S001', 'القطاع الرئيسي للمراكز', 'active'],
    );
    defaultSector = await get('SELECT * FROM sectors WHERE id = ?', [result.id]);
  }
  await run('UPDATE centers SET sector_id = ? WHERE sector_id IS NULL', [defaultSector.id]);

  await run(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      center_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      category TEXT,
      unit TEXT,
      quantity_per_person REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER UNIQUE NOT NULL,
      current_quantity REAL NOT NULL DEFAULT 0,
      incoming REAL NOT NULL DEFAULT 0,
      outgoing REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      required_quantity REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT,
      date TEXT,
      source TEXT,
      invoice_no TEXT,
      notes TEXT,
      center_id INTEGER,
      person_name TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS distributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      center_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      date TEXT,
      responsible TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL DEFAULT 'نظام إدارة الاحتياجات',
      currency TEXT NOT NULL DEFAULT 'ريال',
      alert_threshold REAL NOT NULL DEFAULT 20,
      report_footer TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      user_id INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  const userCount = await get('SELECT COUNT(*) as count FROM users');
  if (!userCount || Number(userCount.count) === 0) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      throw new Error('ADMIN_PASSWORD is required to initialize an empty database.');
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await run(
      'INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
      ['admin', passwordHash, '???? ??????', 'Admin', 'active'],
    );
  }

  const settingsCount = await get('SELECT COUNT(*) as count FROM settings');
  if (!settingsCount || Number(settingsCount.count) === 0) {
    await run(
      'INSERT INTO settings (company_name, currency, alert_threshold, report_footer, created_at) VALUES (?, ?, ?, ?, ?)',
      ['نظام إدارة الاحتياجات', 'ريال', 20, 'مستند صادر من نظام إدارة الاحتياجات', nowIso()],
    );
  }

  const centerCount = await get('SELECT COUNT(*) as count FROM centers');
  if (!centerCount || Number(centerCount.count) === 0) {
    const centers = [
      ['مركز المدينة', 'C001', defaultSector.id, 100, 'مركز رئيسي في المدينة', 'active'],
      ['مركز الشمال', 'C002', defaultSector.id, 100, 'مركز شمال المدينة', 'active'],
      ['مركز الجنوب', 'C003', defaultSector.id, 100, 'مركز جنوب المدينة', 'active'],
      ['مركز الشرق', 'C004', defaultSector.id, 100, 'مركز شرق المدينة', 'active'],
      ['مركز الغرب', 'C005', defaultSector.id, 100, 'مركز غرب المدينة', 'active'],
    ];

    for (const [name, code, sectorId, peopleCount, notes, status] of centers) {
      await run('INSERT INTO centers (name, code, sector_id, people_count, notes, status) VALUES (?, ?, ?, ?, ?, ?)', [name, code, sectorId, peopleCount, notes, status]);
    }

    const items = [
      ['الأرز', 'I001', 'حبوب', 'كيلوجرام', 0.25, 1500, 'أساسي', 'active'],
      ['الزيت', 'I002', 'زيوت', 'لتر', 0.02, 300, 'أساسي', 'active'],
      ['المكرونة', 'I003', 'حبوب', 'كيلوجرام', 0.15, 1200, 'أساسي', 'active'],
      ['السكر', 'I004', 'مستلزمات', 'كيلوجرام', 0.05, 600, 'أساسي', 'active'],
      ['اللحم', 'I005', 'لحوم', 'كيلوجرام', 0.2, 2000, 'أساسي', 'active'],
      ['الماء', 'I006', 'مشروبات', 'لتر', 0.4, 500, 'أساسي', 'active'],
    ];

    for (const [name, code, category, unit, quantityPerPerson, minStock, notes, status] of items) {
      await run(
        'INSERT INTO items (name, code, category, unit, quantity_per_person, min_stock, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, code, category, unit, quantityPerPerson, minStock, notes, status],
      );
    }

    const insertedItems = await all('SELECT * FROM items ORDER BY id');
    for (const item of insertedItems) {
      const stock = item.unit === 'كيلوجرام' ? 1500 : item.unit === 'لتر' ? 800 : 200;
      const required = 500 * Number(item.quantity_per_person || 0);
      await run(
        'INSERT INTO inventory (item_id, current_quantity, incoming, outgoing, min_stock, required_quantity, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [item.id, stock, stock, 0, item.min_stock, required, nowIso()],
      );
    }

    for (const item of insertedItems) {
      await run(
        'INSERT INTO inventory_transactions (item_id, type, quantity, unit, date, source, invoice_no, notes, center_id, person_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.id, 'incoming', item.min_stock * 1.5, item.unit, '2026-09-01', 'مورد تجريبي', 'INV-1001', 'رصيد أولي تجريبي', null, null, 1, nowIso()],
      );
    }

    await logActivity('تجهيز النظام', 'تمت تهيئة القيم التجريبية الأولية', 1);
  }
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'غير مصرح. الرجاء تسجيل الدخول.' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ message: 'رمز الدخول غير صالح أو منتهي الصلاحية.' });
  }

  req.user = decoded;
  next();
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: 'اسم المستخدم وكلمة المرور مطلوبان.' });
  }

  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  await logActivity('تسجيل دخول', `تم تسجيل الدخول بواسطة ${user.name}`, user.id);
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.get('/api/auth/session', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const centers = await all(`
    SELECT c.*, s.name AS sector_name, CASE
      WHEN COALESCE(c.people_count, 0) > 0 THEN c.people_count
      ELSE COUNT(p.id)
    END AS people_count
    FROM centers c
    LEFT JOIN sectors s ON s.id = c.sector_id
    LEFT JOIN people p ON p.center_id = c.id
    GROUP BY c.id
    ORDER BY c.id
  `);
  const items = await all('SELECT * FROM items ORDER BY name');
  const centerPeopleRows = await all('SELECT center_id, COUNT(*) AS total FROM people GROUP BY center_id');
  const peopleCountByCenter = Object.fromEntries(centerPeopleRows.map((row) => [Number(row.center_id), sanitizeNumber(row.total, 0)]));
  const totalPeople = centers.reduce((sum, center) => {
    const centerPeople = sanitizeNumber(center.people_count, 0) > 0 ? sanitizeNumber(center.people_count, 0) : sanitizeNumber(peopleCountByCenter[center.id], 0);
    return sum + centerPeople;
  }, 0);

  const needsByItem = items.map((item) => {
    const required = totalPeople * sanitizeNumber(item.quantity_per_person);
    return {
      ...item,
      required_quantity: required,
      unit: item.unit,
      total_people: totalPeople,
    };
  });

  const totalRequiredQuantity = needsByItem.reduce((sum, item) => sum + sanitizeNumber(item.required_quantity), 0);

  const inventoryRows = await all(`
    SELECT i.*, it.name AS item_name, it.unit AS item_unit, it.quantity_per_person, it.category
    FROM inventory i
    LEFT JOIN items it ON it.id = i.item_id
    ORDER BY it.name
  `);

  const inventoryMap = Object.fromEntries(inventoryRows.map((row) => [row.item_id, row]));

  const shortages = items
    .map((item) => {
      const stock = sanitizeNumber(inventoryMap[item.id]?.current_quantity);
      const required = totalPeople * sanitizeNumber(item.quantity_per_person);
      const shortage = Math.max(0, required - stock);
      return {
        ...item,
        stock,
        required_quantity: required,
        shortage,
      };
    })
    .filter((item) => item.shortage > 0);

  const recentActivity = await all(`
    SELECT a.*, u.name AS user_name
    FROM activity_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC
    LIMIT 8
  `);

  const centerBreakdown = centers.map((center) => {
    const centerPeople = sanitizeNumber(center.people_count, 0) > 0 ? sanitizeNumber(center.people_count, 0) : sanitizeNumber(peopleCountByCenter[center.id], 0);
    return {
      ...center,
      people_count: centerPeople,
      percentage: totalPeople === 0 ? 0 : (centerPeople / totalPeople) * 100,
    };
  });

  res.json({
    summary: {
      totalCenters: centers.length,
      totalPeople,
      totalItems: items.length,
      totalRequiredQuantity,
      totalCalculations: needsByItem.length,
      stockAlerts: shortages.length,
    },
    needsByItem,
    centerBreakdown,
    shortages,
    recentActivity,
  });
});

app.get('/api/centers', requireAuth, async (req, res) => {
  const centers = await all(`
    SELECT c.*, s.name AS sector_name, CASE
      WHEN COALESCE(c.people_count, 0) > 0 THEN c.people_count
      ELSE COUNT(p.id)
    END AS people_count
    FROM centers c
    LEFT JOIN sectors s ON s.id = c.sector_id
    LEFT JOIN people p ON p.center_id = c.id
    GROUP BY c.id
    ORDER BY c.id
  `);
  res.json(centers);
});

app.get('/api/sectors', requireAuth, async (req, res) => {
  const sectors = await all(`
    SELECT s.*, COUNT(c.id) AS centers_count
    FROM sectors s
    LEFT JOIN centers c ON c.sector_id = s.id
    GROUP BY s.id
    ORDER BY s.id
  `);
  res.json(sectors);
});

app.post('/api/sectors', requireAuth, async (req, res) => {
  const { name, code, notes, status } = req.body || {};
  if (!name || !code) {
    return res.status(400).json({ message: 'اسم القطاع والكود مطلوبان.' });
  }

  const existing = await get('SELECT id FROM sectors WHERE code = ?', [code]);
  if (existing) {
    return res.status(400).json({ message: 'رمز القطاع موجود بالفعل.' });
  }

  const result = await run(
    'INSERT INTO sectors (name, code, notes, status) VALUES (?, ?, ?, ?)',
    [name, code, notes || '', status || 'active'],
  );
  await logActivity('إضافة قطاع', `تمت إضافة القطاع ${name} بواسطة ${req.user.name}`, req.user.id);
  const saved = await get('SELECT * FROM sectors WHERE id = ?', [result.id]);
  res.status(201).json(saved);
});

app.put('/api/sectors/:id', requireAuth, async (req, res) => {
  const { name, code, notes, status } = req.body || {};
  const id = Number(req.params.id);
  if (!name || !code) {
    return res.status(400).json({ message: 'اسم القطاع والكود مطلوبان.' });
  }

  const existing = await get('SELECT id FROM sectors WHERE code = ? AND id != ?', [code, id]);
  if (existing) {
    return res.status(400).json({ message: 'رمز القطاع موجود بالفعل.' });
  }

  await run(
    'UPDATE sectors SET name = ?, code = ?, notes = ?, status = ? WHERE id = ?',
    [name, code, notes || '', status || 'active', id],
  );
  await logActivity('تعديل قطاع', `تم تعديل القطاع ${name} بواسطة ${req.user.name}`, req.user.id);
  const updated = await get('SELECT * FROM sectors WHERE id = ?', [id]);
  res.json(updated);
});

app.delete('/api/sectors/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const sector = await get('SELECT * FROM sectors WHERE id = ?', [id]);
  if (!sector) {
    return res.status(404).json({ message: 'القطاع غير موجود.' });
  }
  const centerCount = await get('SELECT COUNT(*) AS count FROM centers WHERE sector_id = ?', [id]);
  if (Number(centerCount.count) > 0) {
    return res.status(409).json({ message: 'لا يمكن حذف قطاع يحتوي على مراكز. انقل المراكز أولاً.' });
  }

  await run('DELETE FROM sectors WHERE id = ?', [id]);
  await logActivity('حذف قطاع', `تم حذف القطاع ${sector.name} بواسطة ${req.user.name}`, req.user.id);
  res.json({ success: true });
});

app.post('/api/centers', requireAuth, async (req, res) => {
  const { name, code, sector_id, people_count, notes, status } = req.body || {};
  if (!name || !code || !sector_id) {
    return res.status(400).json({ message: 'اسم المركز والكود والقطاع مطلوبة.' });
  }

  const sector = await get('SELECT id FROM sectors WHERE id = ?', [Number(sector_id)]);
  if (!sector) {
    return res.status(400).json({ message: 'القطاع المحدد غير موجود.' });
  }
  const center = await get('SELECT * FROM centers WHERE code = ?', [code]);
  if (center) {
    return res.status(400).json({ message: 'رمز المركز موجود بالفعل.' });
  }

  const result = await run(
    'INSERT INTO centers (name, code, sector_id, people_count, notes, status) VALUES (?, ?, ?, ?, ?, ?)',
    [name, code, Number(sector_id), sanitizeNumber(people_count, 0), notes || '', status || 'active'],
  );

  await logActivity('إضافة مركز', `تمت إضافة المركز ${name} بواسطة ${req.user.name}`, req.user.id);
  const saved = await get('SELECT * FROM centers WHERE id = ?', [result.id]);
  res.status(201).json(saved);
});

app.put('/api/centers/:id', requireAuth, async (req, res) => {
  const { name, code, sector_id, people_count, notes, status } = req.body || {};
  const id = Number(req.params.id);

  if (!name || !code || !sector_id) {
    return res.status(400).json({ message: 'اسم المركز والكود والقطاع مطلوبة.' });
  }
  const sector = await get('SELECT id FROM sectors WHERE id = ?', [Number(sector_id)]);
  if (!sector) {
    return res.status(400).json({ message: 'القطاع المحدد غير موجود.' });
  }

  await run(
    'UPDATE centers SET name = ?, code = ?, sector_id = ?, people_count = ?, notes = ?, status = ? WHERE id = ?',
    [name, code, Number(sector_id), sanitizeNumber(people_count, 0), notes || '', status || 'active', id],
  );

  await logActivity('تعديل مركز', `تم تعديل المركز ${name} بواسطة ${req.user.name}`, req.user.id);
  const updated = await get('SELECT * FROM centers WHERE id = ?', [id]);
  res.json(updated);
});

app.delete('/api/centers/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await run('DELETE FROM centers WHERE id = ?', [id]);
  await run('DELETE FROM people WHERE center_id = ?', [id]);
  await logActivity('حذف مركز', `تم حذف مركز برقم ${id} بواسطة ${req.user.name}`, req.user.id);
  res.json({ success: true });
});

app.get('/api/people', requireAuth, async (req, res) => {
  const rows = await all(`
    SELECT p.*, c.name AS center_name, c.code AS center_code
    FROM people p
    LEFT JOIN centers c ON c.id = p.center_id
    ORDER BY p.id DESC
  `);
  res.json(rows);
});

app.post('/api/people', requireAuth, async (req, res) => {
  const { name, code, center_id, notes, status } = req.body || {};
  if (!name || !code || !center_id) {
    return res.status(400).json({ message: 'اسم الشخص والكود والمركز مطلوبان.' });
  }

  const center = await get('SELECT * FROM centers WHERE id = ?', [Number(center_id)]);
  if (!center) {
    return res.status(404).json({ message: 'المركز غير موجود.' });
  }

  const existing = await get('SELECT * FROM people WHERE code = ?', [code]);
  if (existing) {
    return res.status(400).json({ message: 'رمز الشخص موجود بالفعل.' });
  }

  const result = await run(
    'INSERT INTO people (name, code, center_id, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name, code, Number(center_id), status || 'active', notes || '', nowIso()],
  );

  await run(
    'UPDATE centers SET people_count = CASE WHEN people_count IS NULL OR people_count = 0 THEN (SELECT COUNT(*) FROM people WHERE center_id = ?) ELSE people_count END WHERE id = ?',
    [Number(center_id), Number(center_id)],
  );

  await logActivity('إضافة شخص', `تمت إضافة ${name} إلى ${center.name} بواسطة ${req.user.name}`, req.user.id);
  const saved = await get('SELECT p.*, c.name AS center_name, c.code AS center_code FROM people p LEFT JOIN centers c ON c.id = p.center_id WHERE p.id = ?', [result.id]);
  res.status(201).json(saved);
});

app.put('/api/people/:id', requireAuth, async (req, res) => {
  const { name, code, center_id, notes, status } = req.body || {};
  const id = Number(req.params.id);

  if (!name || !code || !center_id) {
    return res.status(400).json({ message: 'اسم الشخص والكود والمركز مطلوبان.' });
  }

  const current = await get('SELECT * FROM people WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ message: 'الشخص غير موجود.' });
  }

  const center = await get('SELECT * FROM centers WHERE id = ?', [Number(center_id)]);
  if (!center) {
    return res.status(404).json({ message: 'المركز غير موجود.' });
  }

  await run(
    'UPDATE people SET name = ?, code = ?, center_id = ?, notes = ?, status = ? WHERE id = ?',
    [name, code, Number(center_id), notes || '', status || 'active', id],
  );

  await run(
    'UPDATE centers SET people_count = CASE WHEN people_count IS NULL OR people_count = 0 THEN (SELECT COUNT(*) FROM people WHERE center_id = ?) ELSE people_count END WHERE id = ?',
    [Number(center_id), Number(center_id)],
  );

  if (Number(current.center_id) !== Number(center_id)) {
    await run(
      'UPDATE centers SET people_count = CASE WHEN people_count IS NULL OR people_count = 0 THEN (SELECT COUNT(*) FROM people WHERE center_id = ?) ELSE people_count END WHERE id = ?',
      [Number(current.center_id), Number(current.center_id)],
    );
  }

  await logActivity('تعديل شخص', `تم تعديل بيانات ${name} بواسطة ${req.user.name}`, req.user.id);
  const updated = await get('SELECT p.*, c.name AS center_name, c.code AS center_code FROM people p LEFT JOIN centers c ON c.id = p.center_id WHERE p.id = ?', [id]);
  res.json(updated);
});

app.delete('/api/people/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const person = await get('SELECT * FROM people WHERE id = ?', [id]);
  if (!person) {
    return res.status(404).json({ message: 'الشخص غير موجود.' });
  }

  await run('DELETE FROM people WHERE id = ?', [id]);
  await run(
    'UPDATE centers SET people_count = CASE WHEN people_count IS NULL OR people_count = 0 THEN (SELECT COUNT(*) FROM people WHERE center_id = ?) ELSE people_count END WHERE id = ?',
    [Number(person.center_id), Number(person.center_id)],
  );

  await logActivity('حذف شخص', `تم حذف ${person.name} من المركز ${person.center_id} بواسطة ${req.user.name}`, req.user.id);
  res.json({ success: true });
});

app.get('/api/items', requireAuth, async (req, res) => {
  const items = await all('SELECT * FROM items ORDER BY id');
  res.json(items);
});

app.post('/api/items', requireAuth, async (req, res) => {
  const { name, code, category, unit, quantity_per_person, min_stock, notes, status } = req.body || {};
  if (!name || !code) {
    return res.status(400).json({ message: 'اسم الصنف والكود مطلوبان.' });
  }

  const existing = await get('SELECT * FROM items WHERE code = ?', [code]);
  if (existing) {
    return res.status(400).json({ message: 'رمز الصنف موجود بالفعل.' });
  }

  const result = await run(
    'INSERT INTO items (name, code, category, unit, quantity_per_person, min_stock, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, code, category || 'عام', unit || 'كيلوجرام', sanitizeNumber(quantity_per_person, 0), sanitizeNumber(min_stock, 0), notes || '', status || 'active'],
  );

  await run(
    'INSERT INTO inventory (item_id, current_quantity, incoming, outgoing, min_stock, required_quantity, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [result.id, 0, 0, 0, sanitizeNumber(min_stock, 0), 0, nowIso()],
  );

  await logActivity('إضافة صنف', `تمت إضافة الصنف ${name} بواسطة ${req.user.name}`, req.user.id);
  const saved = await get('SELECT * FROM items WHERE id = ?', [result.id]);
  res.status(201).json(saved);
});

app.put('/api/items/:id', requireAuth, async (req, res) => {
  const { name, code, category, unit, quantity_per_person, min_stock, notes, status } = req.body || {};
  const id = Number(req.params.id);

  if (!name || !code) {
    return res.status(400).json({ message: 'اسم الصنف والكود مطلوبان.' });
  }

  await run(
    'UPDATE items SET name = ?, code = ?, category = ?, unit = ?, quantity_per_person = ?, min_stock = ?, notes = ?, status = ? WHERE id = ?',
    [name, code, category || 'عام', unit || 'كيلوجرام', sanitizeNumber(quantity_per_person, 0), sanitizeNumber(min_stock, 0), notes || '', status || 'active', id],
  );

  await run(
    'UPDATE inventory SET min_stock = ?, last_updated = ? WHERE item_id = ?',
    [sanitizeNumber(min_stock, 0), nowIso(), id],
  );

  await logActivity('تعديل صنف', `تم تعديل الصنف ${name} بواسطة ${req.user.name}`, req.user.id);
  const updated = await get('SELECT * FROM items WHERE id = ?', [id]);
  res.json(updated);
});

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await run('DELETE FROM items WHERE id = ?', [id]);
  await run('DELETE FROM inventory WHERE item_id = ?', [id]);
  await logActivity('حذف صنف', `تم حذف الصنف رقم ${id} بواسطة ${req.user.name}`, req.user.id);
  res.json({ success: true });
});

app.get('/api/inventory', requireAuth, async (req, res) => {
  const rows = await all(`
    SELECT i.*, it.name AS item_name, it.code AS item_code, it.unit AS item_unit, it.min_stock AS item_min_stock
    FROM inventory i
    LEFT JOIN items it ON it.id = i.item_id
    ORDER BY it.name
  `);
  res.json(rows);
});

app.post('/api/inventory/transactions', requireAuth, async (req, res) => {
  const { item_id, type, quantity, unit, date, source, invoice_no, notes, center_id, person_name } = req.body || {};
  const itemId = Number(item_id);
  const qty = sanitizeNumber(quantity, 0);
  if (!itemId || qty <= 0) {
    return res.status(400).json({ message: 'الكمية والصنف مطلوبان.' });
  }

  const item = await get('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!item) {
    return res.status(404).json({ message: 'الصنف غير موجود.' });
  }

  const currentStock = await get('SELECT * FROM inventory WHERE item_id = ?', [itemId]);
  const current = sanitizeNumber(currentStock?.current_quantity, 0);
  const incomingTotal = sanitizeNumber(currentStock?.incoming, 0);
  const outgoingTotal = sanitizeNumber(currentStock?.outgoing, 0);
  const nextQuantity = type === 'incoming' ? current + qty : current - qty;

  await run(
    'INSERT INTO inventory_transactions (item_id, type, quantity, unit, date, source, invoice_no, notes, center_id, person_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [itemId, type, qty, unit || item.unit, date || nowIso().slice(0, 10), source || 'يدوي', invoice_no || '', notes || '', center_id || null, person_name || '', req.user.id, nowIso()],
  );

  await run(
    'UPDATE inventory SET current_quantity = ?, incoming = ?, outgoing = ?, min_stock = ?, last_updated = ? WHERE item_id = ?',
    [
      nextQuantity,
      type === 'incoming' ? incomingTotal + qty : incomingTotal,
      type === 'outgoing' ? outgoingTotal + qty : outgoingTotal,
      sanitizeNumber(item.min_stock, 0),
      nowIso(),
      itemId,
    ],
  );

  await logActivity(type === 'incoming' ? 'وارد مخزون' : 'منصرف مخزون', `تمت ${type === 'incoming' ? 'إضافة' : 'خصم'} ${qty} ${unit || item.unit} من ${item.name} بواسطة ${req.user.name}`, req.user.id);
  const updated = await get('SELECT * FROM inventory WHERE item_id = ?', [itemId]);
  res.status(201).json(updated);
});

app.get('/api/distributions', requireAuth, async (req, res) => {
  const rows = await all(`
    SELECT d.*, c.name AS center_name, s.name AS sector_name, i.name AS item_name
    FROM distributions d
    LEFT JOIN centers c ON c.id = d.center_id
    LEFT JOIN sectors s ON s.id = c.sector_id
    LEFT JOIN items i ON i.id = d.item_id
    ORDER BY d.id DESC
  `);
  res.json(rows);
});

app.post('/api/distributions', requireAuth, async (req, res) => {
  const { center_id, item_id, quantity, date, responsible, notes } = req.body || {};
  const centerId = Number(center_id);
  const itemId = Number(item_id);
  const qty = sanitizeNumber(quantity, 0);

  if (!centerId || !itemId || qty <= 0) {
    return res.status(400).json({ message: 'المركز والصنف والكمية مطلوبة.' });
  }

  const item = await get('SELECT * FROM items WHERE id = ?', [itemId]);
  const center = await get('SELECT * FROM centers WHERE id = ?', [centerId]);
  if (!item || !center) {
    return res.status(404).json({ message: 'المركز أو الصنف غير موجود.' });
  }

  const stock = await get('SELECT * FROM inventory WHERE item_id = ?', [itemId]);
  const nextQuantity = sanitizeNumber(stock?.current_quantity, 0) - qty;

  await run(
    'INSERT INTO distributions (center_id, item_id, quantity, date, responsible, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [centerId, itemId, qty, date || nowIso().slice(0, 10), responsible || 'غير محدد', notes || '', nowIso()],
  );

  await run(
    'UPDATE inventory SET current_quantity = ?, outgoing = ?, last_updated = ? WHERE item_id = ?',
    [nextQuantity, sanitizeNumber(stock?.outgoing, 0) + qty, nowIso(), itemId],
  );

  await logActivity('توزيع', `تم توزيع ${qty} ${item.unit} من ${item.name} إلى ${center.name} بواسطة ${req.user.name}`, req.user.id);
  const inserted = await all('SELECT * FROM distributions ORDER BY id DESC LIMIT 1');
  res.status(201).json(inserted[0]);
});

app.get('/api/reports', requireAuth, async (req, res) => {
  const { centerId, itemId } = req.query;

  const centers = await all(`
    SELECT c.*, s.name AS sector_name, CASE
      WHEN COALESCE(c.people_count, 0) > 0 THEN c.people_count
      ELSE COUNT(p.id)
    END AS people_count
    FROM centers c
    LEFT JOIN sectors s ON s.id = c.sector_id
    LEFT JOIN people p ON p.center_id = c.id
    GROUP BY c.id
    ORDER BY c.id
  `);
  const items = await all('SELECT * FROM items ORDER BY id');

  const filteredNeeds = centers.flatMap((center) => {
    const centerPeople = sanitizeNumber(center.people_count, 0) > 0 ? sanitizeNumber(center.people_count, 0) : 0;
    return items
      .filter((item) => !itemId || Number(item.id) === Number(itemId))
      .map((item) => ({
        sector_name: center.sector_name,
        center_name: center.name,
        center_id: center.id,
        item_name: item.name,
        item_unit: item.unit,
        people_count: centerPeople,
        per_person: item.quantity_per_person,
        total_quantity: Number(centerPeople) * Number(item.quantity_per_person),
      }));
  }).filter((row) => !centerId || Number(row.center_id) === Number(centerId));

  const inventoryRows = await all(`
    SELECT i.*, it.name AS item_name, it.unit AS item_unit
    FROM inventory i
    LEFT JOIN items it ON it.id = i.item_id
    WHERE (? IS NULL OR i.item_id = ?)
    ORDER BY it.name
  `, [itemId || null, itemId ? Number(itemId) : 0]);

  const transactionRows = await all(`
    SELECT t.*, i.name AS item_name, c.name AS center_name
    FROM inventory_transactions t
    LEFT JOIN items i ON i.id = t.item_id
    LEFT JOIN centers c ON c.id = t.center_id
    WHERE (? IS NULL OR t.item_id = ?)
      AND (? IS NULL OR t.center_id = ?)
    ORDER BY t.created_at DESC
  `, [itemId || null, itemId ? Number(itemId) : 0, centerId || null, centerId ? Number(centerId) : 0]);

  res.json({
    needsReport: filteredNeeds,
    inventoryReport: inventoryRows,
    transactions: transactionRows,
    centers,
    items,
  });
});

app.get('/api/activity', requireAuth, async (req, res) => {
  const logs = await all(`
    SELECT a.*, u.name AS user_name
    FROM activity_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC
  `);
  res.json(logs);
});

app.get('/api/settings', requireAuth, async (req, res) => {
  const settings = await get('SELECT * FROM settings ORDER BY id DESC LIMIT 1');
  res.json(settings || { company_name: 'نظام إدارة الاحتياجات', currency: 'ريال', alert_threshold: 20, report_footer: 'مستند صادر من النظام' });
});

app.put('/api/settings', requireAuth, async (req, res) => {
  const { company_name, currency, alert_threshold, report_footer } = req.body || {};
  const current = await get('SELECT * FROM settings ORDER BY id DESC LIMIT 1');

  if (current) {
    await run(
      'UPDATE settings SET company_name = ?, currency = ?, alert_threshold = ?, report_footer = ?, created_at = ? WHERE id = ?',
      [company_name || current.company_name, currency || current.currency, sanitizeNumber(alert_threshold, current.alert_threshold), report_footer || current.report_footer, nowIso(), current.id],
    );
  } else {
    await run(
      'INSERT INTO settings (company_name, currency, alert_threshold, report_footer, created_at) VALUES (?, ?, ?, ?, ?)',
      [company_name || 'نظام إدارة الاحتياجات', currency || 'ريال', sanitizeNumber(alert_threshold, 20), report_footer || 'مستند صادر من النظام', nowIso()],
    );
  }

  const updated = await get('SELECT * FROM settings ORDER BY id DESC LIMIT 1');
  await logActivity('تحديث إعدادات', `تم تحديث إعدادات النظام بواسطة ${req.user.name}`, req.user.id);
  res.json(updated);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'food-management-system' });
});

app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (req, res) => {
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    res.sendFile(path.join(distDir, 'index.html'));
    return;
  }

  res.status(200).json({ message: 'Backend ready. Run frontend build to serve the UI.' });
});

async function startServer() {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
