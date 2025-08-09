import Airtable from 'airtable';
import twilio from 'twilio';

export const config = { api: { bodyParser: false } };

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const tableName = process.env.AIRTABLE_TABLE_NAME || 'Daily Logs';

async function parseForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}
function validateTwilioSignature(req, body) {
  try {
    if (process.env.TWILIO_VALIDATE !== 'true') return true;
    const sig = req.headers['x-twilio-signature'];
    if (!sig) return false;
    const url = process.env.TWILIO_WEBHOOK_URL;
    if (!url) return false;
    return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, sig, url, body);
  } catch { return false; }
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
async function save(fields){ const payload={ Date: todayISO(process.env.TIMEZONE||'Europe/London'), Source:'WhatsApp', ...fields };
  return base(tableName).create([{ fields: payload }]); }

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).send('Method Not Allowed');
  const form=await parseForm(req);
  if(!validateTwilioSignature(req,form)) return res.status(403).send('Invalid signature');
  const text=(form.Body||'').trim(); const from=form.From;
  try{
    const type=detectEntryType(text);
    const fields = type==='AM'?parseAM(text): type==='PM'?parsePM(text) : (()=>{throw new Error('Start with \"AM:\" or \"PM:\"');})();
    await save(fields);
    await client.messages.create({ from:process.env.TWILIO_WHATSAPP_NUMBER, to: from,
      body: `${fields.EntryType} check-in saved for ${todayISO(process.env.TIMEZONE||'Europe/London')}. ✅` });
    res.status(200).send('OK');
  } catch(e){
    await client.messages.create({ from:process.env.TWILIO_WHATSAPP_NUMBER, to: from,
      body:`Sorry, couldn't parse it. Use your standard format. Error: ${e?.message}` });
    res.status(200).send('ERR');
  }
}
