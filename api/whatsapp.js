import Airtable from 'airtable';
import twilio from 'twilio';

export const config = { api: { bodyParser: false } };

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Airtable init
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const tableName = process.env.AIRTABLE_TABLE_NAME || 'Daily Logs';

// Helper: parse application/x-www-form-urlencoded without extra deps
async function parseForm(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

// Optional Twilio signature validation
function validateTwilioSignature(req, body) {
  try {
    if (process.env.TWILIO_VALIDATE !== 'true') return true;
    const sig = req.headers['x-twilio-signature'];
    if (!sig) return false;
    const url = process.env.TWILIO_WEBHOOK_URL; // must match exactly as in Twilio console
    if (!url) return false;
    const validator = twilio.validateRequest;
    return validator(process.env.TWILIO_AUTH_TOKEN, sig, url, body);
  } catch (_) { return false; }
}

// ---- Parsing logic ----
function parseAM(bodyText) {
  // Example: "Sleep 7.5h | Mood 4 | Energy 3 | Notes: travel"
  const t = bodyText.replace(/\s+/g, ' ').trim();
  const result = { EntryType: 'AM' };

  const sleep = t.match(/Sleep\s+(\d{1,2}(?:\.\d+)?)\s*h/i);
  if (sleep) result.SleepHours = parseFloat(sleep[1]);

  const mood = t.match(/Mood\s+([1-5])/i);   if (mood)   result.Mood = parseInt(mood[1]);
  const energy = t.match(/Energy\s+([1-5])/i); if (energy) result.Energy = parseInt(energy[1]);

  const notes = t.match(/Notes:\s*(.*)$/i);  if (notes)  result.Notes = notes[1].trim();
  return result;
}

function parsePM(bodyText) {
  // Example: "Training S @RPE 7 | Steps 10500 | Protein 160g | Fiber 30g | Water 3L | Caffeine 120mg after14:00 N | Alcohol 1 units | GI none | Supplements/Creatine 5g | Flags Travel"
  const t = bodyText.replace(/\s+/g, ' ').trim();
  const result = { EntryType: 'PM' };

  const train = t.match(/Training\s+([SCMR])\s*@RPE\s*(\d{1,2})/i);
  if (train) { result.TrainingType = train[1].toUpperCase(); result.RPE = parseInt(train[2]); }

  const steps = t.match(/Steps\s+(\d+)/i);
  if (steps) result.Steps = parseInt(steps[1]);

  const protein = t.match(/Protein\s+(\d{1,4})\s*g/i); if (protein) result.Protein_g = parseInt(protein[1]);
  const fiber = t.match(/Fiber\s+(\d{1,4})\s*g/i); if (fiber) result.Fiber_g = parseInt(fiber[1]);
  const water = t.match(/Water\s+(\d{1,2}(?:\.\d+)?)\s*L/i); if (water) result.Water_L = parseFloat(water[1]);
  const caffeine = t.match(/Caffeine\s+(\d{1,4})\s*mg/i); if (caffeine) result.Caffeine_mg = parseInt(caffeine[1]);
  const after = t.match(/after14:00\s+(Y|N)/i); if (after) result.CaffeineAfter2pm = after[1].toUpperCase();
  const alcohol = t.match(/Alcohol\s+(\d+(?:\.\d+)?)\s*units?/i); if (alcohol) result.Alcohol_units = parseFloat(alcohol[1]);
  const gi = t.match(/GI\s+([^|]+)/i); if (gi) result.GI_Symptoms = gi[1].trim();
  const supp = t.match(/Supplements\/Creatine\s+([^|]+)/i); if (supp) result.Supplements = supp[1].trim();
  const flags = t.match(/Flags\s+(.+)$/i); if (flags) result.Flags = flags[1].trim();
  return result;
}

function detectEntryType(text) {
  if (/^AM[:\-]/i.test(text)) return 'AM';
  if (/^PM[:\-]/i.test(text)) return 'PM';
  // Heuristic: presence of "Sleep" => AM; presence of "Training" => PM
  if (/\bSleep\b/i.test(text)) return 'AM';
  if (/\bTraining\b/i.test(text)) return 'PM';
  return 'UNKNOWN';
}

function todayISO(tz = 'Europe/London') {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [{ value: y },,{ value: m },,{ value: d }] = fmt.formatToParts(now);
  return `${y}-${m}-${d}`; // YYYY-MM-DD
}

async function saveToAirtable(fields) {
  const payload = { Date: todayISO(process.env.TIMEZONE || 'Europe/London'), Source: 'WhatsApp', ...fields };
  return base(tableName).create([{ fields: payload }]);
}

async function sendReply(to, text) {
  try {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to,
      body: text
    });
  } catch (e) {
    console.error('Twilio send error', e?.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const form = await parseForm(req);
  if (!validateTwilioSignature(req, form)) {
    return res.status(403).send('Invalid signature');
  }

  const incomingText = (form.Body || '').trim();
  const from = form.From; // e.g., whatsapp:+44...

  let entryType = detectEntryType(incomingText);
  let fields = {};

  try {
    if (entryType === 'AM') fields = parseAM(incomingText);
    else if (entryType === 'PM') fields = parsePM(incomingText);
    else throw new Error('Could not detect AM/PM. Start message with "AM:" or "PM:"');

    await saveToAirtable(fields);

    const dateStr = todayISO(process.env.TIMEZONE || 'Europe/London');
    await sendReply(from, `${fields.EntryType} check-in saved for ${dateStr}. ✅`);
    return res.status(200).send('OK');
  } catch (e) {
    console.error('Parse/save error', e?.message, incomingText);
    await sendReply(from, `Sorry, I couldn't parse that. Please use your standard one-line format. Error: ${e?.message}`);
    return res.status(200).send('ERR');
  }
}
