// api/whatsapp.js

// --- helpers that don't touch env vars ---
async function parseForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

function parseAM(text){ const t=text.replace(/\s+/g,' ').trim(); const r={EntryType:'AM'};
  const s=t.match(/Sleep\s+(\d{1,2}(?:\.\d+)?)\s*h/i); if(s) r.SleepHours=parseFloat(s[1]);
  const m=t.match(/Mood\s+([1-5])/i); if(m) r.Mood=parseInt(m[1]);
  const e=t.match(/Energy\s+([1-5])/i); if(e) r.Energy=parseInt(e[1]);
  const n=t.match(/Notes:\s*(.*)$/i); if(n) r.Notes=n[1].trim(); return r; }

function parsePM(text){ const t=text.replace(/\s+/g,' ').trim(); const r={EntryType:'PM'};
  const tr=t.match(/Training\s+([SCMR])\s*@RPE\s*(\d{1,2})/i); if(tr){r.TrainingType=tr[1].toUpperCase(); r.RPE=parseInt(tr[2]);}
  const steps=t.match(/Steps\s+(\d+)/i); if(steps) r.Steps=parseInt(steps[1]);
  const protein=t.match(/Protein\s+(\d{1,4})\s*g/i); if(protein) r.Protein_g=parseInt(protein[1]);
  const fiber=t.match(/Fiber\s+(\d{1,4})\s*g/i); if(fiber) r.Fiber_g=parseInt(fiber[1]);
  const water=t.match(/Water\s+(\d{1,2}(?:\.\d+)?)\s*L/i); if(water) r.Water_L=parseFloat(water[1]);
  const caffeine=t.match(/Caffeine\s+(\d{1,4})\s*mg/i); if(caffeine) r.Caffeine_mg=parseInt(caffeine[1]);
  const after=t.match(/after14:00\s+(Y|N)/i); if(after) r.CaffeineAfter2pm=after[1].toUpperCase();
  const alcohol=t.match(/Alcohol\s+(\d+(?:\.\d+)?)\s*units?/i); if(alcohol) r.Alcohol_units=parseFloat(alcohol[1]);
  const gi=t.match(/GI\s+([^|]+)/i); if(gi) r.GI_Symptoms=gi[1].trim();
  const supp=t.match(/Supplements\/Creatine\s+([^|]+)/i); if(supp) r.Supplements=supp[1].trim();
  const flags=t.match(/Flags\s+(.+)$/i); if(flags) r.Flags=flags[1].trim(); return r; }

function detectEntryType(text){ if(/^AM[:\-]/i.test(text))return 'AM'; if(/^PM[:\-]/i.test(text))return 'PM';
  if(/\bSleep\b/i.test(text))return 'AM'; if(/\bTraining\b/i.test(text))return 'PM'; return 'UNKNOWN'; }

function todayISO(tz='Europe/London'){ const now=new Date();
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'});
  const [{value:y},,{value:m},,{value:d}]=f.formatToParts(now); return `${y}-${m}-${d}`; }

// ---- handler ----
export default async function handler(req, res) {
  // Quick check for routing: browser GET should show "up"
  if (req.method !== 'POST') return res.status(200).send('up');

  // Lazy-load deps *inside* the POST path so missing envs don't crash GET
  const { default: Airtable } = await import('airtable');
  const twilioMod = await import('twilio');
  const twilio = twilioMod.default || twilioMod;

  // Read env vars (must be set in Vercel → Settings → Environment Variables)
  const {
    AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME = 'Daily Logs',
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER,
    TIMEZONE = 'Europe/London', TWILIO_VALIDATE = 'false', TWILIO_WEBHOOK_URL
  } = process.env;

  // Minimal guardrails (better error in logs if something is missing)
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(500).send('Airtable env vars missing');
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    return res.status(500).send('Twilio env vars missing');
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

  const form = await parseForm(req);

  // Optional signature validation (keep off until your webhook URL is final)
  if (TWILIO_VALIDATE === 'true') {
    const sig = req.headers['x-twilio-signature'];
    const url = TWILIO_WEBHOOK_URL;
    const valid = twilio.validateRequest(TWILIO_AUTH_TOKEN, sig, url, form);
    if (!valid) return res.status(403).send('Invalid signature');
  }

  const text = (form.Body || '').trim();
  const from = form.From;

  try {
    const type = detectEntryType(text);
    const fields = type === 'AM' ? parseAM(text)
                  : type === 'PM' ? parsePM(text)
                  : (() => { throw new Error('Start with "AM:" or "PM:"'); })();

    const payload = { Date: todayISO(TIMEZONE), Source: 'WhatsApp', ...fields };
    await base(AIRTABLE_TABLE_NAME).create([{ fields: payload }]);

    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: `${fields.EntryType} check-in saved for ${todayISO(TIMEZONE)}. ✅`
    });

    return res.status(200).send('OK');
  } catch (e) {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: `Sorry, couldn't parse it. Use your standard format. Error: ${e?.message}`
    });
    return res.status(200).send('ERR');
  }
}
