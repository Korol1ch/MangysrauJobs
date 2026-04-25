const router = require('express').Router();
const { authOptional } = require('../middleware/auth');

// Проверяем наличие API ключа
function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || '';
}

async function callClaude(body) {
  const key = getApiKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY не настроен на сервере');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Ошибка Anthropic API');
  }
  return data;
}

// ── POST /api/ai/filter ── Фильтрация вакансий под профиль соискателя
router.post('/filter', authOptional, async (req, res) => {
  const { profile, jobs } = req.body;

  if (!jobs || !jobs.length) {
    return res.status(400).json({ error: 'Список вакансий пуст' });
  }

  if (!profile || (!profile.desired && !profile.skills && !profile.expLevel)) {
    return res.status(400).json({ error: 'Профиль соискателя не заполнен' });
  }

  const profileDesc = [
    profile.desired   ? `Желаемая профессия: ${profile.desired}` : '',
    profile.salaryMin ? `Желаемая зарплата: от ${profile.salaryMin}` : '',
    profile.schedule  ? `График: ${profile.schedule}` : '',
    profile.type      ? `Занятость: ${profile.type}` : '',
    profile.skills    ? `Навыки: ${profile.skills}` : '',
    profile.expLevel  ? `Опыт: ${profile.expLevel}` : '',
    profile.education ? `Образование: ${profile.education}` : '',
    profile.about     ? `Дополнительно: ${profile.about}` : '',
  ].filter(Boolean).join('\n');

  const jobList = jobs.map((j, i) =>
    `${i}: ${j.title} — ${j.company}. Зарплата: ${j.salary || 'не указана'}. Тип: ${j.type || ''}. График: ${j.schedule || ''}. Опыт: ${j.experience || ''}. ${j.description || ''}`
  ).join('\n');

  try {
    const data = await callClaude({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: 'Ты помогаешь искать работу в Мангистау, Казахстан. Анализируй профиль соискателя и список вакансий. Отвечай ТОЛЬКО в формате JSON объекта: {"indices": [0,2,5], "reason": "краткое объяснение на русском до 60 слов"}. Без markdown, только JSON.',
      messages: [{
        role: 'user',
        content: `Профиль соискателя:\n${profileDesc}\n\nВакансии:\n${jobList}\n\nВерни JSON с индексами подходящих вакансий и кратким объяснением.`
      }]
    });

    const raw = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);
    res.json({ indices: result.indices || [], reason: result.reason || '' });
  } catch (e) {
    console.error('AI filter error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/generate-desc ── Генерация описания вакансии
router.post('/generate-desc', authOptional, async (req, res) => {
  const { title, company, salary } = req.body;
  if (!title) return res.status(400).json({ error: 'Название должности обязательно' });

  try {
    const data = await callClaude({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: 'Ты помогаешь работодателям в Мангистау (Казахстан) составлять описания вакансий. Отвечай только на русском. Пиши кратко — 2-3 предложения.',
      messages: [{
        role: 'user',
        content: `Напиши описание вакансии: "${title}" в "${company || 'компании'}", зарплата: ${salary || 'обсуждается'}.`
      }]
    });

    const text = data.content?.[0]?.text || '';
    res.json({ text });
  } catch (e) {
    console.error('AI generate-desc error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ai/analyze-profile ── Анализ профиля соискателя
router.post('/analyze-profile', authOptional, async (req, res) => {
  const { skills, expLevel, desired } = req.body;

  try {
    const data = await callClaude({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: 'Ты карьерный консультант для рынка труда Мангистау (Казахстан). Отвечай ТОЛЬКО в формате JSON без markdown и без пояснений. Поля: tips (массив 3 строки), topJobs (массив 3 строки), salaryRange (строка в тенге).',
      messages: [{
        role: 'user',
        content: `Профиль: навыки: ${skills || '—'}, опыт: ${expLevel || '—'}, желаемая работа: ${desired || '—'}. Верни JSON.`
      }]
    });

    const raw = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);
    res.json(result);
  } catch (e) {
    console.error('AI analyze-profile error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
