const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildProfileContext({ profile, experiences, skills, education }) {
  const expText = experiences.length
    ? experiences.map(e => `• ${e.title} at ${e.company} (${e.start_date} – ${e.end_date})\n  ${e.description || ''}`.trim()).join('\n')
    : 'Not provided';
  const skillsText = skills.length ? skills.map(s => s.name).join(', ') : 'Not provided';
  const eduText = education.length
    ? education.map(e => `• ${[e.degree, e.field].filter(Boolean).join(' ')} at ${e.school} (${e.start_date}–${e.end_date})`).join('\n')
    : 'Not provided';

  return `NAME: ${profile.name || 'Unknown'}
HEADLINE: ${profile.headline || ''}
LOCATION: ${profile.location || ''}
SUMMARY: ${profile.summary || ''}

WORK EXPERIENCE:
${expText}

SKILLS: ${skillsText}

EDUCATION:
${eduText}

PREFERENCES:
- Work that energizes: ${profile.energizing_work || 'Not specified'}
- Preferred culture: ${profile.preferred_culture || 'Not specified'}
- Management style: ${profile.management_style || 'Not specified'}
- Running toward: ${profile.running_toward || 'Not specified'}
- Urgency horizon: ${profile.urgency_setting || '90_days'}`;
}

async function generateMatchThesis(profileData, job) {
  const ctx = buildProfileContext(profileData);
  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: 'You are a career strategy expert. Analyze job fit with precision and honesty. Respond only with valid JSON — no markdown, no extra text.',
    messages: [{
      role: 'user',
      content: `Analyze fit between this person and role. Return JSON only.

PROFILE:
${ctx}

JOB:
Company: ${job.company}
Title: ${job.title}
Description: ${job.description || 'Not provided'}
Location: ${job.location || 'Not specified'}

Return this exact JSON shape:
{
  "match_thesis": "2-3 sentence explanation of fit or lack of fit",
  "trajectory": "Where this role leads in 3-5 years",
  "recommended_channel": "warm or direct or linkedin or brief"
}`
    }]
  });

  const msg = await stream.finalMessage();
  const text = msg.content.find(b => b.type === 'text')?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return { match_thesis: text.slice(0, 300), trajectory: '', recommended_channel: 'direct' };
  }
}

async function generateBrief(profileData, job, type = 'full') {
  const ctx = buildProfileContext(profileData);
  const wordTarget = type === 'full' ? '500–800 words' : '150–200 words';
  const execSummaryNote = type === 'full'
    ? 'Begin with a 100-word Executive Micro Summary for decision-makers who skim.\n\n'
    : '';

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    thinking: { type: 'adaptive' },
    system: `You are a senior market intelligence analyst. You write Market Intelligence Briefs that position senior professionals as peers and operators — not applicants.

HARD RULE: Never introduce claims not present in the person's actual profile data. Rephrase, reframe, emphasize — never invent. Write in first person as the sender.`,
    messages: [{
      role: 'user',
      content: `Write a ${type === 'full' ? 'Full' : 'Lite'} Market Intelligence Brief for the role below.

${execSummaryNote}Four sections (in order):
1. THREE MACRO SHIFTS — regulatory, technological, or competitive forces reshaping their industry right now
2. IMPLICATIONS FOR COMPANIES LIKE THEIRS — margin pressure, capability gaps, threats specific to their size and stage
3. SPECIFIC OPPORTUNITY FOR ${job.company.toUpperCase()} — 2–3 observations tied to their actual product and next 12 months
4. WHERE I CONTRIBUTE — 3 bullets connecting my real experience to those pressures in practical terms

Target length: ${wordTarget}

After the brief (on a new line), write exactly:
AUTHENTICITY_SCORE: [0-100]

MY PROFILE:
${ctx}

TARGET ROLE:
Company: ${job.company}
Title: ${job.title}
Description: ${job.description || 'Not provided'}`
    }]
  });

  const msg = await stream.finalMessage();
  const text = msg.content.find(b => b.type === 'text')?.text || '';
  const scoreMatch = text.match(/AUTHENTICITY_SCORE:\s*(\d+)/);
  const authenticity_score = scoreMatch ? parseInt(scoreMatch[1]) : 75;
  const full_text = text.replace(/AUTHENTICITY_SCORE:\s*\d+/, '').trim();

  return { full_text, authenticity_score };
}

async function generateMaterials(profileData, job) {
  const ctx = buildProfileContext(profileData);

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    thinking: { type: 'adaptive' },
    system: `You are an expert resume writer for senior professionals.

HARD RULE: Only use information present in the person's actual profile. Never invent accomplishments, metrics, or claims. Tailor and reframe — never fabricate.`,
    messages: [{
      role: 'user',
      content: `Generate a tailored resume and cover letter for this application.

RESUME: Reorder and reframe existing experience to highlight relevance. Use clean markdown formatting. Keep genuine accomplishments as-is.

COVER LETTER: 3–4 paragraphs. Specific opening hook, 2 paragraphs connecting real experience to this role's actual needs, strong close. Personal and specific — not generic.

Format your response exactly like this (use these exact delimiter lines):
---RESUME---
[resume here]
---COVER LETTER---
[cover letter here]
---AUTHENTICITY_SCORE---
[0-100]

MY PROFILE:
${ctx}

TARGET ROLE:
Company: ${job.company}
Title: ${job.title}
Description: ${job.description || 'Not provided'}`
    }]
  });

  const msg = await stream.finalMessage();
  const text = msg.content.find(b => b.type === 'text')?.text || '';

  const resumeMatch = text.match(/---RESUME---\n([\s\S]*?)---COVER LETTER---/);
  const coverMatch = text.match(/---COVER LETTER---\n([\s\S]*?)---AUTHENTICITY_SCORE---/);
  const scoreMatch = text.match(/---AUTHENTICITY_SCORE---\n?(\d+)/);

  return {
    resume: resumeMatch ? resumeMatch[1].trim() : text.slice(0, 3000),
    cover_letter: coverMatch ? coverMatch[1].trim() : '',
    authenticity_score: scoreMatch ? parseInt(scoreMatch[1]) : 75,
  };
}

async function generateOutreach(profileData, connection, job, brief, includeTransparencyLine) {
  const { profile } = profileData;
  const briefNote = brief?.full_text
    ? `\nI've prepared a Market Intelligence Brief on ${job.company} that I can share — it covers the macro forces shaping their space right now.`
    : '';
  const psLine = includeTransparencyLine
    ? '\n\nP.S. I use a personal research assistant to prepare background on companies I\'m targeting. I review and approve everything myself before it goes out.'
    : '';

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    thinking: { type: 'adaptive' },
    system: `You write warm, personal outreach from senior professionals to their network. These are not cold emails. They reference the real connection, lead with value, and make a simple ask. Write in first person. 150–200 words max.`,
    messages: [{
      role: 'user',
      content: `Write a warm outreach message from ${profile.name || 'me'} to ${connection.name}.

Context:
- ${connection.name} is at ${connection.company || 'a relevant company'} as ${connection.title || 'a contact'}
- Target role: ${job.title} at ${job.company}
- We are LinkedIn connections${briefNote}

The message must:
1. Reference the real connection warmly
2. Lead with value or insight — not "I'm looking for a job"
3. Make a simple ask: chat or intro
4. Sound human, not templated${includeTransparencyLine ? '\n5. End with the P.S. about using a research assistant' : ''}

Sender profile:
${profile.headline || ''}
${profile.summary ? profile.summary.slice(0, 300) : ''}`
    }]
  });

  const msg = await stream.finalMessage();
  const text = msg.content.find(b => b.type === 'text')?.text || '';
  return text.trim() + psLine;
}

async function generateDigest(stats, outreach, activeJobs) {
  const replyRate = outreach.sent > 0 ? Math.round((outreach.replied / outreach.sent) * 100) : 0;
  const jobList = activeJobs.map(j => `• ${j.title} at ${j.company} — ${j.pipeline_stage || 'swiped right'}`).join('\n');

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: 'You write concise, plain-English performance digests for a private job search system. Be direct and honest. If numbers are low, say so. No fluff.',
    messages: [{
      role: 'user',
      content: `Write a Performance Digest from these stats:

PIPELINE:
- Active opportunities: ${stats.active_opportunities}
- Screener calls reached: ${stats.screener_calls}
- Hiring manager conversations: ${stats.hiring_manager_calls}
- Offers / Negotiations: ${stats.offers}
- Opportunities passed on: ${stats.passed}

OUTREACH:
- Messages sent: ${outreach.sent}
- Replies received: ${outreach.replied}
- Reply rate: ${replyRate}%

ACTIVE OPPORTUNITIES:
${jobList || 'None yet'}

Write three sections:
1. What happened (2–3 sentences)
2. What's working (1–2 bullets, or "Nothing yet — see next steps")
3. Next 3 actions (specific and actionable)

Under 350 words. Direct tone.`
    }]
  });

  const msg = await stream.finalMessage();
  return msg.content.find(b => b.type === 'text')?.text || '';
}

module.exports = { generateMatchThesis, generateBrief, generateMaterials, generateOutreach, generateDigest };
