const router = require('express').Router();
const db = require('../db');
const { authRequired, authOptional } = require('../middleware/auth');
const { notifyNewApplication } = require('../bot');

// ── GET /api/jobs ── (список с поиском и фильтрами)
// Query params: q, type, sort (date|ai), limit, offset
router.get('/', authOptional, (req, res) => {
  const { q = '', type = '', sort = 'date', limit = 20, offset = 0 } = req.query;

  let where = ['j.is_active = 1'];
  const params = [];

  // Полнотекстовый поиск
  if (q.trim()) {
    where.push(`(j.title LIKE ? OR j.company LIKE ? OR j.skills LIKE ? OR j.description LIKE ?)`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }

  // Фильтр по типу
  if (type && type !== 'Все') {
    where.push(`j.type = ?`);
    params.push(type);
  }

  const orderBy = sort === 'ai' ? 'j.views DESC, j.created_at DESC' : 'j.created_at DESC';

  const sql = `
    SELECT
      j.*,
      u.name as employer_name,
      u.telegram_username as employer_tg,
      COUNT(a.id) as applicants_count
    FROM jobs j
    JOIN users u ON j.user_id = u.id
    LEFT JOIN applications a ON a.job_id = j.id
    WHERE ${where.join(' AND ')}
    GROUP BY j.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  params.push(Number(limit), Number(offset));

  const jobs = db.prepare(sql).all(...params);
  const total = db.prepare(
    `SELECT COUNT(*) as cnt FROM jobs j WHERE ${where.join(' AND ')}`
  ).get(...params.slice(0, -2));

  // Парсим JSON массив навыков
  const result = jobs.map(j => ({
    ...j,
    skills: safeParseJSON(j.skills, [])
  }));

  res.json({ jobs: result, total: total.cnt });
});

// ── GET /api/jobs/:id ── (одна вакансия)
router.get('/:id', authOptional, (req, res) => {
  const job = db.prepare(`
    SELECT j.*, u.name as employer_name, u.telegram_username as employer_tg,
           COUNT(a.id) as applicants_count
    FROM jobs j
    JOIN users u ON j.user_id = u.id
    LEFT JOIN applications a ON a.job_id = j.id
    WHERE j.id = ? AND j.is_active = 1
    GROUP BY j.id
  `).get(req.params.id);

  if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });

  // Увеличиваем счётчик просмотров
  db.prepare('UPDATE jobs SET views = views + 1 WHERE id = ?').run(job.id);

  res.json({ ...job, skills: safeParseJSON(job.skills, []) });
});

// ── POST /api/jobs ── (создать вакансию, только employer)
router.post('/', authRequired, (req, res) => {
  if (req.user.role !== 'employer') {
    return res.status(403).json({ error: 'Только работодатели могут публиковать вакансии' });
  }

  const { title, company, location, salary, type, schedule, experience, skills, description, contact } = req.body;

  if (!title || !company) {
    return res.status(400).json({ error: 'Название и компания обязательны' });
  }

  const result = db.prepare(`
    INSERT INTO jobs (user_id, title, company, location, salary, type, schedule, experience, skills, description, contact)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, title, company,
    location || 'Актау',
    salary || null,
    type || 'Полная',
    schedule || null,
    experience || 'Без опыта',
    JSON.stringify(Array.isArray(skills) ? skills : (skills ? skills.split(',').map(s => s.trim()) : [])),
    description || null,
    contact || null
  );

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...job, skills: safeParseJSON(job.skills, []) });
});

// ── PUT /api/jobs/:id ── (редактировать свою вакансию)
router.put('/:id', authRequired, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });
  if (job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });

  const { title, company, location, salary, type, schedule, experience, skills, description, contact, is_active } = req.body;

  db.prepare(`
    UPDATE jobs SET
      title=?, company=?, location=?, salary=?, type=?, schedule=?,
      experience=?, skills=?, description=?, contact=?, is_active=?
    WHERE id=?
  `).run(
    title || job.title, company || job.company,
    location || job.location, salary || job.salary,
    type || job.type, schedule || job.schedule,
    experience || job.experience,
    skills ? JSON.stringify(Array.isArray(skills) ? skills : skills.split(',').map(s => s.trim())) : job.skills,
    description || job.description, contact || job.contact,
    is_active !== undefined ? (is_active ? 1 : 0) : job.is_active,
    job.id
  );

  res.json({ message: 'Вакансия обновлена' });
});

// ── DELETE /api/jobs/:id ──
router.delete('/:id', authRequired, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });
  if (job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });

  db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
  res.json({ message: 'Вакансия удалена' });
});

// ── GET /api/jobs/my/list ── (мои вакансии — для работодателя)
router.get('/my/list', authRequired, (req, res) => {
  const jobs = db.prepare(`
    SELECT j.*, COUNT(a.id) as applicants_count
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.id
    WHERE j.user_id = ?
    GROUP BY j.id
    ORDER BY j.created_at DESC
  `).all(req.user.id);

  res.json(jobs.map(j => ({ ...j, skills: safeParseJSON(j.skills, []) })));
});

// ── POST /api/jobs/:id/apply ── (откликнуться)
router.post('/:id/apply', authRequired, async (req, res) => {
  if (req.user.role !== 'seeker') {
    return res.status(403).json({ error: 'Только соискатели могут откликаться' });
  }

  const job = db.prepare(`
    SELECT j.*, u.telegram_id as employer_tg_id, u.name as employer_name
    FROM jobs j JOIN users u ON j.user_id = u.id
    WHERE j.id = ? AND j.is_active = 1
  `).get(req.params.id);

  if (!job) return res.status(404).json({ error: 'Вакансия не найдена' });

  // Проверяем что соискатель существует в БД (мог слететь после сброса /tmp)
  const seeker = db.prepare('SELECT name, phone, telegram_username FROM users WHERE id = ?').get(req.user.id);
  if (!seeker) {
    return res.status(401).json({ error: 'Сессия устарела. Войдите снова.' });
  }

  try {
    db.prepare('INSERT INTO applications (job_id, user_id, message) VALUES (?, ?, ?)')
      .run(job.id, req.user.id, req.body.message || null);
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Вы уже откликались на эту вакансию' });
    }
    if (e.message.includes('FOREIGN KEY')) {
      return res.status(401).json({ error: 'Сессия устарела. Войдите снова.' });
    }
    throw e;
  }

  // Уведомление работодателю в Telegram
  if (job.employer_tg_id) {
    notifyNewApplication(job.employer_tg_id, {
      jobTitle: job.title,
      seekerName: seeker.name,
      seekerPhone: seeker.phone,
      seekerTg: seeker.telegram_username,
      message: req.body.message
    }).catch(() => {});
  }

  res.status(201).json({ message: 'Отклик отправлен!' });
});

// ── GET /api/jobs/my/applications ── (мои отклики — для соискателя)
router.get('/my/applications', authRequired, (req, res) => {
  const apps = db.prepare(`
    SELECT a.*, j.title, j.company, j.salary, j.type, j.location
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
  `).all(req.user.id);
  res.json(apps);
});

// ── GET /api/jobs/:id/applications ── (отклики на мою вакансию)
router.get('/:id/applications', authRequired, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Не найдена' });
  if (job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });

  const apps = db.prepare(`
    SELECT a.*, u.name, u.phone, u.telegram_username, u.telegram_id
    FROM applications a
    JOIN users u ON a.user_id = u.id
    WHERE a.job_id = ?
    ORDER BY a.created_at DESC
  `).all(job.id);
  res.json(apps);
});

// ── PATCH /api/jobs/:jobId/applications/:appId ── (принять / отклонить)
router.patch('/:jobId/applications/:appId', authRequired, async (req, res) => {
  const { status } = req.body; // accepted | rejected
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status: accepted или rejected' });
  }

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
  if (!job || job.user_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' });

  const app = db.prepare('SELECT a.*, u.telegram_id, u.name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?').get(req.params.appId);
  if (!app) return res.status(404).json({ error: 'Отклик не найден' });

  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, app.id);

  // Уведомление соискателю
  if (app.telegram_id) {
    const { notifyApplicationStatus } = require('../bot');
    notifyApplicationStatus(app.telegram_id, {
      jobTitle: job.title,
      company: job.company,
      status,
      employerContact: job.contact
    }).catch(() => {});
  }

  res.json({ message: `Статус обновлён: ${status}` });
});

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
