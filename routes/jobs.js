const router = require('express').Router();
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { notifyNewApplication } = require('../bot');

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── GET /api/jobs ──
router.get('/', authOptional, async (req, res) => {
  const { q = '', type = '', sort = 'date', limit = 20, offset = 0 } = req.query;

  let where = ['j.is_active = 1'];
  const params = [];

  if (q.trim()) {
    where.push(`(j.title ILIKE ? OR j.company ILIKE ? OR j.skills ILIKE ? OR j.description ILIKE ?)`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  if (type && type !== 'Все') {
    where.push(`j.type = ?`);
    params.push(type);
  }

  const orderBy = sort === 'ai' ? 'j.views DESC, j.created_at DESC' : 'j.created_at DESC';

  const sql = `
    SELECT j.*, u.name as employer_name, u.telegram_username as employer_tg,
           COUNT(a.id) as applicants_count
    FROM jobs j
    JOIN users u ON j.user_id = u.id
    LEFT JOIN applications a ON a.job_id = j.id
    WHERE ${where.join(' AND ')}
    GROUP BY j.id, u.name, u.telegram_username
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  params.push(Number(limit), Number(offset));

  const countSql = `SELECT COUNT(*) as cnt FROM jobs j WHERE ${where.join(' AND ')}`;

  try {
    const jobs = await db.all(sql, params);
    const totalRow = await db.get(countSql, params.slice(0, -2));
    const result = jobs.map(j => ({ ...j, skills: safeParseJSON(j.skills, []) }));
    res.json({ jobs: result, total: Number(totalRow?.cnt || 0) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/jobs/my/list ── (важно — до /:id!)
router.get('/my/list', authRequired, async (req, res) => {
  try {
    const jobs = await db.all(`
      SELECT j.*, COUNT(a.id) as applicants_count
      FROM jobs j
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.user_id = ?
      GROUP BY j.id
      ORDER BY j.created_at DESC
    `, [req.user.id]);
    res.json(jobs.map(j => ({ ...j, skills: safeParseJSON(j.skills, []) })));
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/jobs/my/applications ──
router.get('/my/applications', authRequired, async (req, res) => {
  try {
    const apps = await db.all(`
      SELECT a.*, j.title, j.company, j.salary, j.type, j.location
      FROM applications a JOIN jobs j ON a.job_id = j.id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC
    `, [req.user.id]);
    res.json(apps);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/jobs/:id ──
router.get('/:id', authOptional, async (req, res) => {
  try {
    const job = await db.get(`
      SELECT j.*, u.name as employer_name, u.telegram_username as employer_tg,
             COUNT(a.id) as applicants_count
      FROM jobs j JOIN users u ON j.user_id = u.id
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.id = ? AND j.is_active = 1
      GROUP BY j.id, u.name, u.telegram_username
    `, [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });
    await db.run('UPDATE jobs SET views = views + 1 WHERE id = ?', [job.id]);
    res.json({ ...job, skills: safeParseJSON(job.skills, []) });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/jobs ──
router.post('/', authRequired, async (req, res) => {
  if (req.user.role !== 'employer')
    return res.status(403).json({ error: 'Только работодатели могут публиковать вакансии' });

  const { title, company, location, salary, type, schedule, experience, skills, description, contact } = req.body;
  if (!title || !company)
    return res.status(400).json({ error: 'Название и компания обязательны' });

  try {
    const skillsJson = JSON.stringify(
      Array.isArray(skills) ? skills : (skills ? skills.split(',').map(s => s.trim()) : [])
    );
    const result = await db.run(`
      INSERT INTO jobs (user_id, title, company, location, salary, type, schedule, experience, skills, description, contact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [req.user.id, title, company, location || 'Актау', salary || null,
        type || 'Полная', schedule || null, experience || 'Без опыта',
        skillsJson, description || null, contact || null]);

    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ ...job, skills: safeParseJSON(job.skills, []) });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PUT /api/jobs/:id ──
router.put('/:id', authRequired, async (req, res) => {
  try {
    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });
    if (job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });

    const { title, company, location, salary, type, schedule, experience, skills, description, contact, is_active } = req.body;
    const skillsJson = skills
      ? JSON.stringify(Array.isArray(skills) ? skills : skills.split(',').map(s => s.trim()))
      : job.skills;

    await db.run(`
      UPDATE jobs SET title=?, company=?, location=?, salary=?, type=?, schedule=?,
        experience=?, skills=?, description=?, contact=?, is_active=? WHERE id=?
    `, [title || job.title, company || job.company, location || job.location,
        salary || job.salary, type || job.type, schedule || job.schedule,
        experience || job.experience, skillsJson, description || job.description,
        contact || job.contact,
        is_active !== undefined ? (is_active ? 1 : 0) : job.is_active,
        job.id]);

    res.json({ message: 'Вакансия обновлена' });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE /api/jobs/:id ──
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });
    if (job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });
    await db.run('DELETE FROM jobs WHERE id = ?', [job.id]);
    res.json({ message: 'Вакансия удалена' });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/jobs/:id/apply ──
router.post('/:id/apply', authRequired, async (req, res) => {
  if (req.user.role !== 'seeker')
    return res.status(403).json({ error: 'Только соискатели могут откликаться' });

  try {
    const job = await db.get(`
      SELECT j.*, u.telegram_id as employer_tg_id, u.name as employer_name
      FROM jobs j JOIN users u ON j.user_id = u.id
      WHERE j.id = ? AND j.is_active = 1
    `, [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });

    const seeker = await db.get('SELECT name, phone, telegram_username FROM users WHERE id = ?', [req.user.id]);
    if (!seeker) return res.status(401).json({ error: 'Сессия устарела. Войдите снова.' });

    try {
      await db.run('INSERT INTO applications (job_id, user_id, message) VALUES (?, ?, ?)',
        [job.id, req.user.id, req.body.message || null]);
    } catch (e) {
      if (e.message.includes('unique') || e.message.includes('UNIQUE') || e.code === '23505')
        return res.status(409).json({ error: 'Вы уже откликались на эту вакансию' });
      throw e;
    }

    if (job.employer_tg_id) {
      notifyNewApplication(job.employer_tg_id, {
        jobTitle: job.title, seekerName: seeker.name,
        seekerPhone: seeker.phone, seekerTg: seeker.telegram_username,
        message: req.body.message
      }).catch(() => {});
    }

    res.status(201).json({ message: 'Отклик отправлен!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/jobs/:id/applications ──
router.get('/:id/applications', authRequired, async (req, res) => {
  try {
    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Не найдена' });
    if (job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });
    const apps = await db.all(`
      SELECT a.*, u.name, u.phone, u.telegram_username, u.telegram_id
      FROM applications a JOIN users u ON a.user_id = u.id
      WHERE a.job_id = ? ORDER BY a.created_at DESC
    `, [job.id]);
    res.json(apps);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PATCH /api/jobs/:jobId/applications/:appId ──
router.patch('/:jobId/applications/:appId', authRequired, async (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status))
    return res.status(400).json({ error: 'status: accepted или rejected' });

  try {
    const job = await db.get('SELECT * FROM jobs WHERE id = ?', [req.params.jobId]);
    if (!job || job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });

    const app = await db.get(
      'SELECT a.*, u.telegram_id, u.name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?',
      [req.params.appId]
    );
    if (!app) return res.status(404).json({ error: 'Отклик не найден' });

    await db.run('UPDATE applications SET status = ? WHERE id = ?', [status, app.id]);

    if (app.telegram_id) {
      const { notifyApplicationStatus } = require('../bot');
      notifyApplicationStatus(app.telegram_id, {
        jobTitle: job.title, company: job.company,
        status, employerContact: job.contact
      }).catch(() => {});
    }

    res.json({ message: `Статус обновлён: ${status}` });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
