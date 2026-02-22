CREATE TABLE IF NOT EXISTS profile (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT,
  headline TEXT,
  summary TEXT,
  location TEXT,
  urgency_setting TEXT DEFAULT '90_days',
  mode TEXT DEFAULT 'light',
  energizing_work TEXT,
  preferred_culture TEXT,
  management_style TEXT,
  team_dynamics TEXT,
  running_toward TEXT,
  compensation_meaning TEXT,
  search_motivation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiences (
  id SERIAL PRIMARY KEY,
  company TEXT,
  title TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  name TEXT
);

CREATE TABLE IF NOT EXISTS education (
  id SERIAL PRIMARY KEY,
  school TEXT,
  degree TEXT,
  field TEXT,
  start_date TEXT,
  end_date TEXT
);

CREATE TABLE IF NOT EXISTS connections (
  id SERIAL PRIMARY KEY,
  name TEXT,
  company TEXT,
  title TEXT,
  connected_on TEXT,
  email TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  url TEXT,
  salary_range TEXT,
  match_thesis TEXT,
  trajectory TEXT,
  recommended_channel TEXT,
  source TEXT DEFAULT 'manual',
  swipe_status TEXT DEFAULT 'pending',
  pipeline_stage TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS swipes (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  voice_note_transcript TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS briefs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE UNIQUE,
  type TEXT DEFAULT 'full',
  content JSONB,
  full_text TEXT,
  authenticity_score INTEGER,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE UNIQUE,
  resume TEXT,
  cover_letter TEXT,
  authenticity_score INTEGER,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outreach (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'warm',
  message TEXT,
  include_transparency_line BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_events (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  notes TEXT,
  entered_at TIMESTAMPTZ DEFAULT NOW()
);
