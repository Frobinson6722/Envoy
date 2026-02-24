# CLAUDE.md — Envoy Codebase Guide

Envoy is a **private career intelligence engine**: a single-user, self-hosted Node.js/Express app backed by PostgreSQL. It uses Claude Opus 4.6 to analyze job fit, generate tailored application materials, surface warm network paths, and track a full-cycle job search pipeline. There is no multi-user auth, no marketplace, no public-facing recruiter side.

---

## Repository Layout

```
Envoy/
├── server.js          # Entire Express API (571 lines) — all routes live here
├── services/
│   └── ai.js          # All Claude API calls (253 lines)
├── db/
│   └── schema.sql     # PostgreSQL schema — run via initDb() on startup
├── public/            # Vanilla HTML/CSS/JS frontend (no build step)
│   ├── index.html     # Landing / marketing page
│   ├── dashboard.html # App hub — stats, next actions, urgency settings
│   ├── onboarding.html# Profile setup, LinkedIn CSV import, feature tour
│   ├── feed.html      # Add jobs, swipe to evaluate fit
│   ├── brief.html     # View / edit / approve Market Intelligence Briefs
│   ├── materials.html # Resume + cover letter generation and approval
│   ├── network.html   # LinkedIn connections import, warm path matching
│   ├── pipeline.html  # 8-stage career funnel with conversion tracking
│   ├── css/
│   │   └── style.css  # Shared styles (Google Material Design, Roboto font)
│   └── js/
│       └── envoy.js   # Shared utility — server uptime indicator
├── Dockerfile         # node:20-alpine, production build
├── .env.example       # Environment variable template
├── package.json       # npm project manifest
└── .gitignore         # Excludes node_modules/, .env
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 4.x |
| Database | PostgreSQL (via `pg` v8) with SSL |
| AI | Claude Opus 4.6 (`@anthropic-ai/sdk` v0.39) |
| Frontend | Vanilla HTML5 / CSS3 / JavaScript — no framework, no bundler |
| File uploads | Multer (temp files written to `/tmp/envoy/`) |
| CSV parsing | `csv-parse` (sync API) |
| Config | `dotenv` |
| Container | Docker — Alpine Linux |

---

## Environment Variables

Copy `.env.example` to `.env` before running locally.

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

- `DATABASE_URL` — SSL is enabled automatically when this variable is set (`rejectUnauthorized: false` to support self-signed cloud certs).
- `PORT` defaults to `8000` in code (matches Koyeb health-check default); `.env.example` shows `3000` — override as needed.

---

## Running the Application

```bash
npm install          # Install dependencies
node server.js       # Start the server
```

Or with Docker:

```bash
docker build -t envoy .
docker run -p 3000:3000 --env-file .env envoy
```

**No build step exists.** The frontend is served as static files from `public/`. The database schema is applied automatically at startup via `initDb()` using `CREATE TABLE IF NOT EXISTS`, so it is safe to run against an existing database.

---

## Database Schema

All tables use `SERIAL PRIMARY KEY`. Schema is idempotent (safe to re-run). Foreign keys use `ON DELETE CASCADE` except `outreach.connection_id` which uses `ON DELETE SET NULL`.

| Table | Purpose | Notable Columns |
|---|---|---|
| `profile` | Single user record | `urgency_setting`, `mode` (light/dark), career preference fields |
| `experiences` | Work history | `company`, `title`, `start_date`, `end_date`, `description` |
| `skills` | Skill tags | `name` |
| `education` | Academic background | `school`, `degree`, `field`, `start_date`, `end_date` |
| `connections` | LinkedIn network | `name`, `company`, `title`, `email` |
| `jobs` | Tracked opportunities | `swipe_status` (pending/active/passed), `pipeline_stage`, AI-generated fields |
| `swipes` | User decisions | `direction` (right/left), optional `voice_note_transcript` |
| `briefs` | Market Intelligence Briefs | `type` (full/lite), `content` (JSONB), `full_text`, `authenticity_score`, `status` (draft/approved) |
| `materials` | Resumes + cover letters | `resume` (markdown), `cover_letter`, `authenticity_score`, `status` (draft/approved) |
| `outreach` | Warm intro tracking | `type` (warm), `status` (draft/sent/replied), `include_transparency_line` |
| `pipeline_events` | Funnel stage history | `stage`, `notes`, `entered_at` |

**Profile is a single-row table.** All queries use `LIMIT 1` or upsert patterns. Do not add multi-user logic without a major architectural change.

**`jobs.pipeline_stage` valid values** (defined as `STAGES` constant in `server.js`):
`target`, `brief`, `materials`, `outreach`, `applied`, `screen`, `interview`, `offer`

**`profile.urgency_setting` valid values:**
`30_days`, `60_days`, `90_days`, `180_days`, `open`

---

## API Reference

All routes are in `server.js`. There are no route files — everything is registered on the single `app` instance.

### Profile (`/api/profile`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/profile` | Returns `{ profile, experiences, skills, education }` |
| POST | `/api/profile/upload-csv` | Multipart upload of up to 4 LinkedIn CSV exports |
| PUT | `/api/profile` | Update basic identity fields |
| PUT | `/api/profile/preferences` | Update career preference fields |
| PUT | `/api/profile/urgency` | Update `urgency_setting` and `mode` |
| POST | `/api/profile/experience` | Add a manual experience entry |
| DELETE | `/api/profile/experience/:id` | Remove an experience entry |

### Jobs (`/api/jobs`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/jobs` | All jobs (ordered by `created_at DESC`) |
| POST | `/api/jobs` | Add a job (`company`, `title` required) |
| GET | `/api/jobs/:id` | Single job record |
| DELETE | `/api/jobs/:id` | Delete job (cascades to all related records) |
| POST | `/api/jobs/:id/analyze` | Run `generateMatchThesis()` — stores result in `jobs` row |
| POST | `/api/jobs/:id/swipe` | Record swipe decision; updates `jobs.swipe_status` |

### Briefs (`/api/briefs`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/briefs` | All briefs (joined with job title/company) |
| GET | `/api/briefs/:jobId` | Brief for a specific job |
| POST | `/api/briefs/generate/:jobId` | Generate via AI; upserts `briefs` row |
| PUT | `/api/briefs/:jobId` | Manual edit (full_text, content) |
| POST | `/api/briefs/:jobId/approve` | Set `status = 'approved'` |

### Materials (`/api/materials`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/materials` | All materials (joined with job) |
| GET | `/api/materials/:jobId` | Materials for a specific job |
| POST | `/api/materials/generate/:jobId` | Generate via AI; upserts `materials` row |
| PUT | `/api/materials/:jobId` | Manual edit |
| POST | `/api/materials/:jobId/approve` | Set `status = 'approved'` |

### Network (`/api/network`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/network` | All connections |
| POST | `/api/network/upload-csv` | Import LinkedIn connections CSV |
| GET | `/api/network/match/:jobId` | Find connections at the same company as the job |

### Outreach (`/api/outreach`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/outreach` | All outreach records |
| POST | `/api/outreach/draft` | Draft warm intro via AI |
| PUT | `/api/outreach/:id` | Update message or status |
| POST | `/api/outreach/:id/send` | Mark as sent (`status = 'sent'`, `sent_at = NOW()`) |

### Pipeline (`/api/pipeline`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/pipeline` | Jobs grouped by `pipeline_stage` |
| POST | `/api/pipeline/stage` | Move job to a new stage |
| GET | `/api/pipeline/stats` | Conversion metrics by stage |
| GET | `/api/digest` | AI-generated performance summary |

### System
| Method | Path | Description |
|---|---|---|
| GET | `/api/version` | Returns `{ uptime_seconds, started_at }` |

---

## AI Integration (`services/ai.js`)

All Claude calls follow the same pattern:

1. Build a profile context string via `buildProfileContext()`.
2. Stream a request to Claude Opus 4.6 with `thinking: { type: 'adaptive' }`.
3. Collect the full streamed text.
4. Parse JSON from the response (with a fallback regex strip of markdown fences).
5. Return the parsed object.

### Functions

| Function | Output | Notes |
|---|---|---|
| `generateMatchThesis(profileData, job)` | `{ match_thesis, trajectory, recommended_channel }` | `recommended_channel` is one of: `warm`, `direct`, `linkedin`, `brief` |
| `generateBrief(profileData, job, type)` | `{ sections[], full_text, authenticity_score }` | `type` is `full` (500-800 words) or `lite` (150-200 words) |
| `generateMaterials(profileData, job)` | `{ resume, cover_letter, authenticity_score }` | Resume is markdown-formatted |
| `generateOutreach(profileData, job, connection, includeTransparencyLine)` | `{ message }` | Drafts a warm introduction to a specific connection |
| `generateDigest(profileData, stats, jobs)` | `{ summary, highlights[], next_actions[] }` | Performance digest with actionable next steps |

### AI Conventions to Preserve

- **"Never invent" principle**: All prompts explicitly instruct Claude not to fabricate credentials, companies, achievements, or metrics not present in the profile data.
- **Adaptive thinking**: `thinking: { type: 'adaptive' }` is set on every call — do not remove this.
- **JSON-only responses**: System prompts instruct Claude to return only valid JSON with no markdown wrapping. The response parser strips fences as a safety net but the prompts should enforce this.
- **Authenticity scoring**: `generateBrief` and `generateMaterials` return an `authenticity_score` (0–100) representing how closely the output maps to real profile data. Preserve this field.

---

## Frontend Architecture

- **No build step, no bundler, no framework.** All pages are standalone HTML files.
- Shared styles live in `css/style.css`. Inline `<style>` blocks are used within pages for page-specific overrides.
- `js/envoy.js` is the only shared script — it fetches `/api/version` to display a server uptime indicator in the corner of each page.
- Each page manages its own API calls using native `fetch()`.
- Dark/light mode is stored in `profile.mode` and applied via a `<body class="dark">` toggle.
- The design system is Google Material Design inspired, using the Roboto font from Google Fonts.

---

## Code Conventions

### Naming
- **Database columns**: `snake_case`
- **JavaScript variables/functions**: `camelCase`
- **CSS classes**: `kebab-case`
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `STAGES`, `URGENCY_LABELS`, `STAGE_LABELS` in `server.js`)

### Error Handling
All API routes follow this pattern:
```js
try {
  // ... logic
  res.json({ success: true });
} catch (err) { res.status(500).json({ error: err.message }); }
```
There is no custom error middleware. Errors surface as `{ error: "message" }` with HTTP 500.

### Database Access
- Use the `pool` (connection pool) directly for single-query operations.
- For multi-table writes, acquire a client from the pool, use `BEGIN`/`COMMIT`/`ROLLBACK`, and always `client.release()` in `finally`.
- Always use parameterized queries (`$1`, `$2`, ...) — never string interpolation in SQL.

### File Uploads
- Multer writes temp files to `/tmp/envoy/`.
- Call `cleanTemp(req.files)` in `finally` to delete temp files after processing.

### LinkedIn CSV Column Mapping
The LinkedIn export format uses these exact column names — do not change the mapping:

| CSV Field | Table Column |
|---|---|
| `First Name` + `Last Name` | `profile.name` |
| `Headline` | `profile.headline` |
| `Summary` | `profile.summary` |
| `Geo Location` | `profile.location` |
| `Company Name` | `experiences.company` |
| `Title` | `experiences.title` |
| `Started On` | `experiences.start_date` |
| `Finished On` | `experiences.end_date` |
| `Description` | `experiences.description` |
| `Name` (skills) | `skills.name` |
| `School Name` | `education.school` |
| `Degree Name` | `education.degree` |
| `Notes` | `education.field` |
| `Start Date` | `education.start_date` |
| `End Date` | `education.end_date` |

---

## Key Design Principles

1. **Privacy-first**: Single-user, self-hosted. No external data sharing, no recruiter marketplace.
2. **Authenticity over automation**: AI materials must reflect real experience. The `authenticity_score` field enforces accountability.
3. **Warm network priority**: The system favors warm introductions over cold outreach. `recommended_channel` from `generateMatchThesis` drives this.
4. **Screener conversion as north star**: The pipeline tracks conversion rates stage-by-stage. The digest surfaces these metrics.
5. **No fabrication**: AI prompts are engineered to use only data present in the profile. Adding new AI functions should preserve this constraint.

---

## No Tests

There are currently **no automated tests**. When adding new features, manually verify:
- Database operations complete without error
- AI responses parse as valid JSON
- Frontend pages correctly render API responses
- CSV imports handle malformed input gracefully

---

## Deployment

The app is designed for cloud deployment (Koyeb, Railway, Render, Fly.io, etc.):

- **Port**: Defaults to `8000` in `server.js` (`process.env.PORT || 8000`). Koyeb health checks use port 8000.
- **SSL**: Automatically enabled for PostgreSQL when `DATABASE_URL` is set.
- **Docker**: `docker build -t envoy . && docker run -p 8000:8000 --env-file .env envoy`
- **Health check**: `GET /api/version` returns uptime — suitable for load balancer health checks.
- **Static files**: Served by Express from `public/` — no CDN or reverse proxy required for small-scale use.

---

## Common Tasks for AI Assistants

### Adding a new API endpoint
1. Add the route handler in `server.js` near related routes (grouped by feature area).
2. Use `pool.query()` with parameterized queries.
3. Follow the existing `try/catch` error pattern.
4. If the endpoint needs AI, add a function to `services/ai.js` following the stream → collect → parse JSON pattern.

### Adding a new frontend page
1. Create `public/newpage.html`.
2. Link `css/style.css` and `js/envoy.js` in the `<head>` / before `</body>`.
3. Use `fetch('/api/...')` for all data — no client-side routing library.
4. Apply dark mode by reading `profile.mode` on load and toggling `document.body.classList`.

### Modifying the database schema
1. Edit `db/schema.sql`.
2. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for additive changes (the schema runs on startup via `CREATE TABLE IF NOT EXISTS`, so existing tables are not recreated).
3. For destructive changes, run SQL manually against the database.

### Changing AI behavior
1. Edit the relevant function in `services/ai.js`.
2. Do not remove `thinking: { type: 'adaptive' }`.
3. Do not weaken the "never invent" constraint in prompts.
4. Keep system prompts focused on JSON-only output to preserve the parsing logic.
