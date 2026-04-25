require('dotenv').config();

const USE_PG = !!process.env.DATABASE_URL;

// ════════════════════════════════════════
//  PostgreSQL (если DATABASE_URL задан)
// ════════════════════════════════════════
if (USE_PG) {
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('❌ PostgreSQL pool error:', err.message);
  });

  async function initDB() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                SERIAL PRIMARY KEY,
        name              TEXT NOT NULL,
        email             TEXT UNIQUE NOT NULL,
        password          TEXT NOT NULL,
        role              TEXT NOT NULL DEFAULT 'seeker',
        phone             TEXT,
        telegram_id       TEXT,
        telegram_username TEXT,
        link_code         TEXT,
        link_code_exp     BIGINT,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        company     TEXT NOT NULL,
        location    TEXT,
        salary      TEXT,
        type        TEXT DEFAULT 'Полная',
        schedule    TEXT,
        experience  TEXT DEFAULT 'Без опыта',
        skills      TEXT DEFAULT '[]',
        description TEXT,
        contact     TEXT,
        is_active   INTEGER DEFAULT 1,
        views       INTEGER DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS applications (
        id         SERIAL PRIMARY KEY,
        job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message    TEXT,
        status     TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(job_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_type   ON jobs(type);
      CREATE INDEX IF NOT EXISTS idx_apps_job    ON applications(job_id);
      CREATE INDEX IF NOT EXISTS idx_apps_user   ON applications(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_tg    ON users(telegram_id);
      CREATE INDEX IF NOT EXISTS idx_users_link  ON users(link_code);
    `);
    console.log('✅ PostgreSQL подключён — данные сохраняются навсегда');
  }

  initDB().catch(err => {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    console.error('   Проверьте DATABASE_URL в переменных окружения Render');
    process.exit(1);
  });

  // Заменяет ? на $1,$2,... для pg
  function toPositional(sql, params = []) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  module.exports = {
    async all(sql, params = []) {
      const { rows } = await pool.query(toPositional(sql, params), params);
      return rows;
    },
    async get(sql, params = []) {
      const { rows } = await pool.query(toPositional(sql, params), params);
      return rows[0] || null;
    },
    async run(sql, params = []) {
      const isInsert = /^\s*INSERT/i.test(sql);
      const finalSql = isInsert
        ? toPositional(sql, params) + ' RETURNING id'
        : toPositional(sql, params);
      const { rows, rowCount } = await pool.query(finalSql, params);
      return { lastInsertRowid: isInsert ? rows[0]?.id : null, changes: rowCount };
    },
    async exec(sql) { await pool.query(sql); },
    pool,
    dialect: 'pg',
  };

// ════════════════════════════════════════
//  SQLite fallback (если DATABASE_URL не задан)
// ════════════════════════════════════════
} else {
  const Database = require('better-sqlite3');
  const path = require('path');
  const fs = require('fs');

  // На Render без PostgreSQL — предупреждаем что данные временные
  if (process.env.NODE_ENV === 'production') {
    console.warn('⚠️  DATABASE_URL не задан! Используется SQLite — данные будут теряться при перезапуске!');
    console.warn('   Добавьте PostgreSQL в Render Dashboard для постоянного хранения данных.');
  }

  const DB_PATH = process.env.DB_PATH || path.join('/tmp', 'mangystau.db');
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'seeker', phone TEXT,
      telegram_id TEXT, telegram_username TEXT,
      link_code TEXT, link_code_exp INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, company TEXT NOT NULL, location TEXT,
      salary TEXT, type TEXT DEFAULT 'Полная', schedule TEXT,
      experience TEXT DEFAULT 'Без опыта', skills TEXT DEFAULT '[]',
      description TEXT, contact TEXT, is_active INTEGER DEFAULT 1,
      views INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT, status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_type   ON jobs(type);
    CREATE INDEX IF NOT EXISTS idx_apps_job    ON applications(job_id);
    CREATE INDEX IF NOT EXISTS idx_apps_user   ON applications(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_tg    ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_users_link  ON users(link_code);
  `);
  console.log('✅ SQLite подключён:', DB_PATH);

  module.exports = {
    async all(sql, params = []) { return sqlite.prepare(sql).all(...params); },
    async get(sql, params = [])  { return sqlite.prepare(sql).get(...params) || null; },
    async run(sql, params = []) {
      const r = sqlite.prepare(sql).run(...params);
      return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
    },
    async exec(sql) { sqlite.exec(sql); },
    dialect: 'sqlite',
  };
}
