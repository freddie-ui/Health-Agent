# WhatsApp Health Agent – Twilio Webhook + Airtable (Vercel)

Capture AM/PM WhatsApp check-ins and store them in Airtable.

## AM format (your standard)
```
AM: Sleep 7.5h | Mood 4 | Energy 3 | Notes: travel
```

## PM format
```
PM: Training S @RPE 7 | Steps 10500 | Protein 160g | Fiber 30g | Water 3L | Caffeine 120mg after14:00 N | Alcohol 1 units | GI none | Supplements/Creatine 5g | Flags Travel
```

## Airtable: Table `Daily Logs` fields (case-sensitive)
- Date (Date), Source (Single line text), EntryType (Single select: AM, PM)
- SleepHours (Number, 1 decimal)
- Mood (Number), Energy (Number), Notes (Long text)
- Steps (Number), TrainingType (Single select: S, C, M, R), RPE (Number)
- Protein_g (Number), Fiber_g (Number), Water_L (Number, 1 decimal)
- Caffeine_mg (Number), CaffeineAfter2pm (Single select: Y, N)
- Alcohol_units (Number, 1 decimal)
- GI_Symptoms (Long text), Supplements (Long text), Flags (Long text)

## Deploy (Vercel)
1. Create a new Vercel project and upload this folder (or push to Git and import).
2. Add Environment Variables from `.env.example`.
3. Deploy. Copy your deployment URL, e.g. `https://your-app.vercel.app/api/whatsapp`.
4. In Twilio WhatsApp Sandbox, set "WHEN A MESSAGE COMES IN" to that URL.

## Troubleshooting
- 403 Invalid signature → set `TWILIO_VALIDATE=false` or ensure URL matches `TWILIO_WEBHOOK_URL`.
- No reply → check Twilio logs; ensure your phone joined the Sandbox; confirm `TWILIO_WHATSAPP_NUMBER`.
- Airtable errors → verify PAT scopes & Base ID/Table name.

