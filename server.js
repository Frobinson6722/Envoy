require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');
const ai = require('./services/ai');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});
const upload = multer({ dest: '/tmp/envoy/' });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── DB INIT ─────────────────────────────────────────────────────────────────

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Database ready');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function getProfileData() {
  const [p, e, s, ed] = await Promise.all([
    pool.query('SELECT * FROM profile LIMIT 1'),
    pool.query('SELECT * FROM experiences ORDER BY start_date DESC'),
    pool.query('SELECT * FROM skills'),
    pool.query('SELECT * FROM education ORDER BY start_date DESC'),
  ]);
  return { profile: p.rows[0] || {}, experiences: e.rows, skills: s.rows, education: ed.rows };
}

function cleanTemp(files) {
  Object.values(files || {}).flat().forEach(f => {
    try { fs.unlinkSync(f.path); } catch {}
  });
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────

app.get('/api/profile', async (req, res) => {
  try {
    res.json(await getProfileData());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/profile/upload-csv',
  upload.fields([
    { name: 'profile', maxCount: 1 },
    { name: 'positions', maxCount: 1 },
    { name: 'skills', maxCount: 1 },
    { name: 'education', maxCount: 1 },
  ]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (req.files?.profile?.[0]) {
        const rows = parse(fs.readFileSync(req.files.profile[0].path, 'utf8'), { columns: true, skip_empty_lines: true });
        if (rows.length) {
          const r = rows[0];
          const name = [r['First Name'], r['Last Name']].filter(Boolean).join(' ');
          const existing = await client.query('SELECT id FROM profile LIMIT 1');
          if (existing.rows.length) {
            await client.query(
              'UPDATE profile SET name=$1, headline=$2, summary=$3, location=$4, updated_at=NOW() WHERE id=$5',
              [name, r['Headline'], r['Summary'], r['Geo Location'], existing.rows[0].id]
            );
          } else {
            await client.query(
              'INSERT INTO profile (name, headline, summary, location) VALUES ($1,$2,$3,$4)',
              [name, r['Headline'], r['Summary'], r['Geo Location']]
            );
          }
        }
      }

      if (req.files?.positions?.[0]) {
        const rows = parse(fs.readFileSync(req.files.positions[0].path, 'utf8'), { columns: true, skip_empty_lines: true });
        await client.query('DELETE FROM experiences');
        for (const r of rows) {
          await client.query(
            'INSERT INTO experiences (company, title, start_date, end_date, description) VALUES ($1,$2,$3,$4,$5)',
            [r['Company Name'], r['Title'], r['Started On'], r['Finished On'] || 'Present', r['Description']]
          );
        }
      }

      if (req.files?.skills?.[0]) {
        const rows = parse(fs.readFileSync(req.files.skills[0].path, 'utf8'), { columns: true, skip_empty_lines: true });
        await client.query('DELETE FROM skills');
        for (const r of rows) {
          if (r['Name']) await client.query('INSERT INTO skills (name) VALUES ($1)', [r['Name']]);
        }
      }

      if (req.files?.education?.[0]) {
        const rows = parse(fs.readFileSync(req.files.education[0].path, 'utf8'), { columns: true, skip_empty_lines: true });
        await client.query('DELETE FROM education');
        for (const r of rows) {
          await client.query(
            'INSERT INTO education (school, degree, field, start_date, end_date) VALUES ($1,$2,$3,$4,$5)',
            [r['School Name'], r['Degree Name'], r['Notes'], r['Start Date'], r['End Date']]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
      cleanTemp(req.files);
    }
  }
);

app.put('/api/profile', async (req, res) => {
  const { name, email, headline, summary, location } = req.body;
  try {
    const existing = await pool.query('SELECT id FROM profile LIMIT 1');
    if (existing.rows.length) {
      await pool.query(
        'UPDATE profile SET name=$1, email=$2, headline=$3, summary=$4, location=$5, updated_at=NOW() WHERE id=$6',
        [name, email, headline, summary, location, existing.rows[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO profile (name, email, headline, summary, location) VALUES ($1,$2,$3,$4,$5)',
        [name, email, headline, summary, location]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/profile/preferences', async (req, res) => {
  const { energizing_work, preferred_culture, management_style, team_dynamics, running_toward, compensation_meaning, search_motivation } = req.body;
  try {
    const existing = await pool.query('SELECT id FROM profile LIMIT 1');
    if (!existing.rows.length) await pool.query('INSERT INTO profile DEFAULT VALUES');
    await pool.query(
      `UPDATE profile SET energizing_work=$1, preferred_culture=$2, management_style=$3,
       team_dynamics=$4, running_toward=$5, compensation_meaning=$6, search_motivation=$7, updated_at=NOW()`,
      [energizing_work, preferred_culture, management_style, team_dynamics, running_toward, compensation_meaning, search_motivation]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/profile/urgency', async (req, res) => {
  const { urgency_setting, mode } = req.body;
  try {
    const existing = await pool.query('SELECT id FROM profile LIMIT 1');
    if (!existing.rows.length) await pool.query('INSERT INTO profile DEFAULT VALUES');
    await pool.query('UPDATE profile SET urgency_setting=$1, mode=$2, updated_at=NOW()', [urgency_setting, mode]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Experience CRUD (for manual entry)
app.post('/api/profile/experience', async (req, res) => {
  const { company, title, start_date, end_date, description } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO experiences (company, title, start_date, end_date, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [company, title, start_date, end_date, description]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/profile/experience/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM experiences WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── JOBS ─────────────────────────────────────────────────────────────────────

app.get('/api/jobs', async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    let where = '';
    if (status) { where = ' WHERE swipe_status=$1'; params.push(status); }
    const result = await pool.query('SELECT * FROM jobs' + where + ' ORDER BY created_at DESC', params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/jobs', async (req, res) => {
  const { company, title, description, location, url, salary_range } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO jobs (company, title, description, location, url, salary_range) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [company, title, description, location, url, salary_range]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/jobs/:id/analyze', async (req, res) => {
  try {
    const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id])).rows[0];
    if (!job) return res.status(404).json({ error: 'Not found' });
    const profileData = await getProfileData();
    const analysis = await ai.generateMatchThesis(profileData, job);
    await pool.query(
      'UPDATE jobs SET match_thesis=$1, trajectory=$2, recommended_channel=$3 WHERE id=$4',
      [analysis.match_thesis, analysis.trajectory, analysis.recommended_channel, req.params.id]
    );
    res.json(analysis);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SWIPES ──────────────────────────────────────────────────────────────────

app.post('/api/jobs/:id/swipe', async (req, res) => {
  const { direction, voice_note_transcript } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO swipes (job_id, direction, voice_note_transcript) VALUES ($1,$2,$3)',
      [req.params.id, direction, voice_note_transcript]
    );
    const newStatus = direction === 'right' ? 'active' : 'passed';
    const newStage = direction === 'right' ? 'swiped_right' : null;
    await client.query('UPDATE jobs SET swipe_status=$1, pipeline_stage=$2 WHERE id=$3', [newStatus, newStage, req.params.id]);
    if (direction === 'right') {
      await client.query('INSERT INTO pipeline_events (job_id, stage) VALUES ($1,$2)', [req.params.id, 'swiped_right']);
    }
    await client.query('COMMIT');
    res.json({ success: true, status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ─── BRIEFS ──────────────────────────────────────────────────────────────────

app.get('/api/briefs', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT b.*, j.company, j.title FROM briefs b JOIN jobs j ON b.job_id=j.id ORDER BY b.updated_at DESC'
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/briefs/:jobId', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM briefs WHERE job_id=$1', [req.params.jobId]);
    res.json(r.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/briefs/generate/:jobId', async (req, res) => {
  const { type } = req.body;
  try {
    const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const profileData = await getProfileData();
    const brief = await ai.generateBrief(profileData, job, type || 'full');
    const existing = (await pool.query('SELECT id FROM briefs WHERE job_id=$1', [req.params.jobId])).rows[0];
    if (existing) {
      await pool.query(
        'UPDATE briefs SET type=$1, full_text=$2, authenticity_score=$3, status=$4, updated_at=NOW() WHERE job_id=$5',
        [type || 'full', brief.full_text, brief.authenticity_score, 'draft', req.params.jobId]
      );
    } else {
      await pool.query(
        'INSERT INTO briefs (job_id, type, full_text, authenticity_score) VALUES ($1,$2,$3,$4)',
        [req.params.jobId, type || 'full', brief.full_text, brief.authenticity_score]
      );
    }
    res.json((await pool.query('SELECT * FROM briefs WHERE job_id=$1', [req.params.jobId])).rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/briefs/:jobId', async (req, res) => {
  const { full_text } = req.body;
  try {
    await pool.query('UPDATE briefs SET full_text=$1, updated_at=NOW() WHERE job_id=$2', [full_text, req.params.jobId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/briefs/:jobId/approve', async (req, res) => {
  try {
    await pool.query("UPDATE briefs SET status='approved', updated_at=NOW() WHERE job_id=$1", [req.params.jobId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MATERIALS ───────────────────────────────────────────────────────────────

app.get('/api/materials', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT m.*, j.company, j.title FROM materials m JOIN jobs j ON m.job_id=j.id ORDER BY m.updated_at DESC'
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/materials/:jobId', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM materials WHERE job_id=$1', [req.params.jobId]);
    res.json(r.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/materials/generate/:jobId', async (req, res) => {
  try {
    const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const profileData = await getProfileData();
    const mats = await ai.generateMaterials(profileData, job);
    const existing = (await pool.query('SELECT id FROM materials WHERE job_id=$1', [req.params.jobId])).rows[0];
    if (existing) {
      await pool.query(
        'UPDATE materials SET resume=$1, cover_letter=$2, authenticity_score=$3, status=$4, updated_at=NOW() WHERE job_id=$5',
        [mats.resume, mats.cover_letter, mats.authenticity_score, 'draft', req.params.jobId]
      );
    } else {
      await pool.query(
        'INSERT INTO materials (job_id, resume, cover_letter, authenticity_score) VALUES ($1,$2,$3,$4)',
        [req.params.jobId, mats.resume, mats.cover_letter, mats.authenticity_score]
      );
    }
    res.json((await pool.query('SELECT * FROM materials WHERE job_id=$1', [req.params.jobId])).rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/materials/:jobId', async (req, res) => {
  const { resume, cover_letter } = req.body;
  try {
    await pool.query(
      'UPDATE materials SET resume=$1, cover_letter=$2, updated_at=NOW() WHERE job_id=$3',
      [resume, cover_letter, req.params.jobId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/materials/:jobId/approve', async (req, res) => {
  try {
    await pool.query("UPDATE materials SET status='approved', updated_at=NOW() WHERE job_id=$1", [req.params.jobId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── NETWORK ─────────────────────────────────────────────────────────────────

app.get('/api/network', async (req, res) => {
  const { company } = req.query;
  try {
    const params = [];
    let where = '';
    if (company) { where = ' WHERE LOWER(company) LIKE $1'; params.push(`%${company.toLowerCase()}%`); }
    const r = await pool.query('SELECT * FROM connections' + where + ' ORDER BY name', params);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/network/upload-csv', upload.single('connections'), async (req, res) => {
  try {
    const rows = parse(fs.readFileSync(req.file.path, 'utf8'), { columns: true, skip_empty_lines: true });
    await pool.query('DELETE FROM connections');
    let count = 0;
    for (const r of rows) {
      const name = [r['First Name'], r['Last Name']].filter(Boolean).join(' ') || r['Name'] || '';
      if (name) {
        await pool.query(
          'INSERT INTO connections (name, company, title, connected_on, email) VALUES ($1,$2,$3,$4,$5)',
          [name, r['Company'], r['Position'], r['Connected On'], r['Email Address']]
        );
        count++;
      }
    }
    fs.unlinkSync(req.file.path);
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/network/match/:jobId', async (req, res) => {
  try {
    const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.jobId])).rows[0];
    if (!job) return res.status(404).json({ error: 'Not found' });
    const connections = (await pool.query(
      'SELECT * FROM connections WHERE LOWER(company) LIKE $1 ORDER BY name',
      [`%${job.company.toLowerCase()}%`]
    )).rows;
    res.json({ job, connections });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── OUTREACH ────────────────────────────────────────────────────────────────

app.get('/api/outreach', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT o.*, j.company, j.title, c.name as connection_name
      FROM outreach o
      JOIN jobs j ON o.job_id=j.id
      LEFT JOIN connections c ON o.connection_id=c.id
      ORDER BY o.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/outreach/draft', async (req, res) => {
  const { job_id, connection_id, include_transparency_line } = req.body;
  try {
    const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [job_id])).rows[0];
    const conn = (await pool.query('SELECT * FROM connections WHERE id=$1', [connection_id])).rows[0];
    if (!job || !conn) return res.status(404).json({ error: 'Job or connection not found' });
    const profileData = await getProfileData();
    const brief = (await pool.query('SELECT * FROM briefs WHERE job_id=$1', [job_id])).rows[0];
    const message = await ai.generateOutreach(profileData, conn, job, brief, include_transparency_line);
    const r = await pool.query(
      'INSERT INTO outreach (job_id, connection_id, type, message, include_transparency_line) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [job_id, connection_id, 'warm', message, include_transparency_line || false]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/outreach/:id', async (req, res) => {
  const { message } = req.body;
  try {
    await pool.query('UPDATE outreach SET message=$1 WHERE id=$2', [message, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/outreach/:id/send', async (req, res) => {
  try {
    await pool.query("UPDATE outreach SET status='sent', sent_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PIPELINE ────────────────────────────────────────────────────────────────

const STAGES = ['swiped_right', 'outreach', 'application', 'screener', 'hiring_manager', 'team_interview', 'offer', 'negotiation'];

app.get('/api/pipeline', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT j.*,
        b.status as brief_status, b.authenticity_score as brief_score,
        m.status as materials_status,
        (SELECT COUNT(*) FROM outreach WHERE job_id=j.id AND status='sent')::int as outreach_sent
      FROM jobs j
      LEFT JOIN briefs b ON b.job_id=j.id
      LEFT JOIN materials m ON m.job_id=j.id
      WHERE j.swipe_status='active'
      ORDER BY j.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pipeline/stage', async (req, res) => {
  const { job_id, stage, notes } = req.body;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE jobs SET pipeline_stage=$1 WHERE id=$2', [stage, job_id]);
    await client.query('INSERT INTO pipeline_events (job_id, stage, notes) VALUES ($1,$2,$3)', [job_id, stage, notes]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.get('/api/pipeline/stats', async (req, res) => {
  try {
    const conv = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE swipe_status='active')::int as active,
        COUNT(*) FILTER (WHERE pipeline_stage='screener')::int as screener_calls,
        COUNT(*) FILTER (WHERE pipeline_stage='hiring_manager')::int as hiring_manager,
        COUNT(*) FILTER (WHERE pipeline_stage='offer' OR pipeline_stage='negotiation')::int as offers,
        COUNT(*) FILTER (WHERE swipe_status='passed')::int as passed
      FROM jobs
    `)).rows[0];
    const out = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='sent')::int as sent,
        COUNT(*) FILTER (WHERE status='replied')::int as replied
      FROM outreach
    `)).rows[0];
    const stages = (await pool.query(`
      SELECT pipeline_stage as stage, COUNT(*)::int as count
      FROM jobs WHERE swipe_status='active' GROUP BY pipeline_stage
    `)).rows;
    res.json({ conversion: conv, outreach: out, stages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/digest', async (req, res) => {
  try {
    const stats = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE swipe_status='active')::int as active_opportunities,
        COUNT(*) FILTER (WHERE pipeline_stage='screener')::int as screener_calls,
        COUNT(*) FILTER (WHERE pipeline_stage='hiring_manager')::int as hiring_manager_calls,
        COUNT(*) FILTER (WHERE pipeline_stage='offer' OR pipeline_stage='negotiation')::int as offers,
        COUNT(*) FILTER (WHERE swipe_status='passed')::int as passed
      FROM jobs
    `)).rows[0];
    const outreach = (await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status='sent')::int as sent,
             COUNT(*) FILTER (WHERE status='replied')::int as replied FROM outreach
    `)).rows[0];
    const activeJobs = (await pool.query(
      "SELECT company, title, pipeline_stage FROM jobs WHERE swipe_status='active' ORDER BY created_at DESC LIMIT 10"
    )).rows;
    const digest = await ai.generateDigest(stats, outreach, activeJobs);
    res.json({ digest });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── START ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(PORT, () => console.log(`Envoy running on http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
