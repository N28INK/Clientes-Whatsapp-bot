// Bot automático: WhatsApp -> Google Sheets ("Clientes").
// Oswaldo escribe el reporte a este número de WhatsApp Business y el bot
// lo registra o actualiza solo en la hoja, usando IA (Groq/Llama 3) para
// entender el texto libre.
//
// Columnas de la hoja (pestaña "Clientes"):
 // A Fecha | B Nombre | C Teléfono | D Vehículo de interés | E Down |
// F Idioma | G Etapa | H Día de cita | I Hora de cita | J Facebook |
// K Dealer | L Última actualización | M Notas | N Fuente | O Birddog

require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio manda el webhook como formulario

const {
  PORT = 3000,
  // Meta (plan A)
  WHATSAPP_VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  // Twilio (plan B)
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM, // ej: whatsapp:+14155238886 (número sandbox de Twilio)
  LLM_API_KEY,
  LLM_MODEL = 'llama-3.3-70b-versatile',
  LLM_BASE_URL = 'https://api.groq.com/openai/v1',
  GOOGLE_SERVICE_ACCOUNT_JSON, // contenido del JSON de la cuenta de servicio (o ruta al archivo en uso local)
  SHEET_ID, // id de la hoja "Clientes"
  SHEET_TAB = 'Clientes',
} = process.env;

const HAS_META = Boolean(WHATSAPP_VERIFY_TOKEN && WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID);
const HAS_TWILIO = Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);

for (const v of ['LLM_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'SHEET_ID']) {
  if (!process.env[v]) {
    console.error(`Falta la variable ${v} en el archivo .env`);
    process.exit(1);
  }
}
if (!HAS_META && !HAS_TWILIO) {
  console.error('Configura Meta (plan A) o Twilio (plan B) en el archivo .env');
  process.exit(1);
}

// ---- Google Sheets ----
const sheets = google.sheets('v4');
let sheetsClient = null;
function buildAuth() {
  const raw = String(GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  // Acepta el contenido JSON pegado como variable de entorno (Render),
  // o la ruta a un archivo .json (uso local).
  if (raw.startsWith('{')) {
    return new google.auth.GoogleAuth({ credentials: JSON.parse(raw), scopes });
  }
  return new google.auth.GoogleAuth({ keyFile: raw, scopes });
}
async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = buildAuth();
  sheetsClient = { auth: await auth.getClient() };
  return sheetsClient;
}
async function readAll() {
  const { auth } = await getSheets();
  const r = await sheets.spreadsheets.values.get({
    auth, spreadsheetId: SHEET_ID, range: `${SHEET_TAB}!A:O`,
  });
  return r.data.values || [];
}
async function appendRow(row) {
  const { auth } = await getSheets();
  await sheets.spreadsheets.values.append({
    auth, spreadsheetId: SHEET_ID, range: `${SHEET_TAB}!A:O`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}
async function updateRow(rowIndex1Based, row) {
  const { auth } = await getSheets();
  await sheets.spreadsheets.values.update({
    auth, spreadsheetId: SHEET_ID, range: `${SHEET_TAB}!A${rowIndex1Based}:O${rowIndex1Based}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

// ---- WhatsApp Cloud API (Meta, plan A) ----
async function sendMeta(to, text) {
  const resp = await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000) } }),
  });
  if (!resp.ok) throw new Error(`WhatsApp ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

// ---- Twilio WhatsApp sandbox (plan B) ----
async function sendTwilio(to, text) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const form = new URLSearchParams({
    From: TWILIO_WHATSAPP_FROM,
    To: `whatsapp:${to}`,
    Body: text.slice(0, 1600),
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!resp.ok) throw new Error(`Twilio ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

// ---- IA: entender el reporte ----
function todayCaracas() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); // YYYY-MM-DD
}

async function parseReport(text, existingNames) {
  const hoy = todayCaracas();
  const prompt = `Hoy es ${hoy} (zona America/Caracas). Eres el registrador de clientes de un vendedor de vehículos financiados en Houston.

El usuario (Oswaldo, el vendedor) te escribe por WhatsApp para reportar un cliente NUEVO o ACTUALIZAR uno existente.
Clientes ya registrados: ${existingNames.length ? existingNames.join(' | ') : '(ninguno)'}.

Analiza su mensaje y responde SOLO con un JSON válido, sin texto extra, con esta forma:
{
  "accion": "nuevo" | "actualizar" | "ignorar",
  "nombre_existente": "nombre exacto de la lista, o null",
  "nombre": "...", "telefono": "...", "vehiculo": "...", "down": 3000,
  "idioma": "español" | "inglés" | null,
  "etapa": "Nuevo" | "Contactada" | "Contactado" | "Cita agendada" | "Visitó" | "Financiamiento" | "Vendido" | "Perdido" | null,
  "dia_cita": "YYYY-MM-DD o texto como 'Por confirmar'",
  "hora_cita": "...",
  "facebook": "...", "dealer": "...", "birddog": "...", "notas": "..."
}

REGLAS:
- "nuevo" si reporta un cliente que NO está en la lista. "actualizar" si el nombre coincide (ignora mayúsculas/acentos) con uno de la lista; pon ese nombre exacto en "nombre_existente".
- "ignorar" si el mensaje no es un reporte de cliente (saludos, preguntas, etc.).
- "pc", "p/c" o "por confirmar" => "Por confirmar".
- "mañana", "pasado mañana", días de semana ("el viernes"): conviértelos a fecha YYYY-MM-DD usando que hoy es ${hoy}.
- down: número sin símbolos ("$3000", "3 mil" => 3000). Si no lo dice, null.
- etapa: si es nuevo y no dice etapa => "Nuevo". Si actualiza y no dice etapa, null (se conserva la actual).
- dia_cita/hora_cita en actualización: si no los menciona, null (se conservan).
- No inventes datos: lo que no diga, null (o "" en texto).

Mensaje de Oswaldo: """${text}"""`;

  const resp = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1, max_tokens: 600,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const raw = (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
  return JSON.parse(raw);
}

const seen = new Set(); // ids de mensajes ya procesados

async function handleText(from, text, messageId, reply) {
  if (seen.has(messageId)) return;
  seen.add(messageId);
  console.log(`WhatsApp de ${from}: ${text.slice(0, 100)}`);

  let rows = [];
  try { rows = await readAll(); } catch (e) {
    console.error('No pude leer la hoja:', e.message);
    await reply(from, '⚠️ No pude abrir la hoja de clientes. Revisa que esté compartida con la cuenta de servicio.');
    return;
  }
  const existingNames = rows.slice(1).map((r) => r[1]).filter(Boolean);

  let p;
  try { p = await parseReport(text, existingNames); }
  catch (e) {
    console.error('Falló la IA:', e.message);
    await reply(from, '⚠️ No entendí el reporte. Escríbelo de nuevo con nombre y datos del cliente.');
    return;
  }

  if (p.accion === 'ignorar' || !p.accion) {
    await reply(from, '👍 Anotado. Si era un reporte de cliente, mándalo con el nombre y los datos.');
    return;
  }

  const hoy = todayCaracas();
  const v = (x) => (x === null || x === undefined ? '' : x);

  if (p.accion === 'nuevo') {
    const row = [hoy, v(p.nombre), v(p.telefono), v(p.vehiculo), v(p.down), v(p.idioma),
      p.etapa || 'Nuevo', v(p.dia_cita), v(p.hora_cita), v(p.facebook), v(p.dealer),
      hoy, v(p.notas), 'WhatsApp', v(p.birddog)];
    await appendRow(row);
    console.log(`Registrado: ${p.nombre}`);
    await reply(from, `✅ Registrado: ${p.nombre}${p.vehiculo ? ` (${p.vehiculo})` : ''}.`);
    return;
  }

  // actualizar
  const idx = rows.findIndex((r, i) => i > 0 && (r[1] || '').trim().toLowerCase() === String(p.nombre_existente || '').trim().toLowerCase());
  if (idx === -1) {
    // No se encontró: lo registra como nuevo para no perder el dato.
    const row = [hoy, v(p.nombre) || v(p.nombre_existente), v(p.telefono), v(p.vehiculo), v(p.down), v(p.idioma),
      p.etapa || 'Nuevo', v(p.dia_cita), v(p.hora_cita), v(p.facebook), v(p.dealer),
      hoy, v(p.notas), 'WhatsApp', v(p.birddog)];
    await appendRow(row);
    await reply(from, `✅ No encontré "${p.nombre_existente}" en la hoja, lo registré como nuevo: ${row[1]}.`);
    return;
  }
  const old = rows[idx];
  const get = (i, nv) => (nv === null || nv === undefined || nv === '' ? (old[i] || '') : nv);
  const row = [old[0] || hoy, old[1], get(2, p.telefono), get(3, p.vehiculo), get(4, p.down),
    get(5, p.idioma), get(6, p.etapa), get(7, p.dia_cita), get(8, p.hora_cita),
    get(9, p.facebook), get(10, p.dealer), hoy, get(12, p.notas), old[13] || 'WhatsApp', get(14, p.birddog)];
  await updateRow(idx + 1, row);
  console.log(`Actualizado: ${old[1]}`);
  const cambios = [];
  if (p.etapa) cambios.push(`etapa: ${p.etapa}`);
  if (p.dia_cita) cambios.push(`cita: ${p.dia_cita}${p.hora_cita ? ' ' + p.hora_cita : ''}`);
  await reply(from, `✅ Actualizado: ${old[1]}${cambios.length ? ' — ' + cambios.join(', ') : ''}.`);
}

// ---- Webhooks de Meta (plan A) ----
if (HAS_META) {
  app.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
      console.log('Webhook verificado por Meta');
      return res.status(200).send(challenge);
    }
    res.sendStatus(403);
  });

  app.post('/webhook/whatsapp', (req, res) => {
    res.sendStatus(200); // responder rápido; el trabajo va después
    (async () => {
      try {
        for (const entry of req.body.entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value || {};
            if (value.messaging_product !== 'whatsapp') continue;
            for (const msg of value.messages || []) {
              if (msg.type !== 'text' || !msg.text || !msg.text.body) {
                if (msg.type && msg.from) {
                  await sendMeta(msg.from, 'Mándame los datos del cliente en texto y lo registro en la hoja 👍');
                }
                continue;
              }
              await handleText(msg.from, msg.text.body, msg.id, sendMeta);
            }
          }
        }
      } catch (e) { console.error('Error en webhook:', e.message); }
    })();
  });
}

// ---- Webhook de Twilio (plan B) ----
if (HAS_TWILIO) {
  app.post('/webhook/twilio', (req, res) => {
    res.sendStatus(200);
    (async () => {
      try {
        const from = String(req.body.From || '').replace(/^whatsapp:/, '');
        const body = req.body.Body || '';
        const sid = req.body.MessageSid || '';
        if (!from || !body) return;
        await handleText(from, body, `twilio-${sid}`, sendTwilio);
      } catch (e) { console.error('Error en webhook Twilio:', e.message); }
    })();
  });
}

// ---- Polling de Twilio (plan B sin webhook) ----
// Twilio quitó la página "Sandbox settings" donde se pegaba el webhook de
// mensajes entrantes, así que el bot va a buscar los mensajes nuevos
// directamente a la API de Twilio cada cierto tiempo.
const TWILIO_POLL_MS = Number(process.env.TWILIO_POLL_MS || 60000);
let twilioPolling = false;
const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

async function pollTwilio(markOnly = false) {
  if (!HAS_TWILIO || twilioPolling) return;
  twilioPolling = true;
  try {
    const myNumber = digitsOnly(TWILIO_WHATSAPP_FROM);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json?PageSize=20`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) throw new Error(`Twilio poll HTTP ${resp.status}`);
    const data = await resp.json();
    const msgs = (data.messages || [])
      .filter((m) => m.direction === 'inbound'
        && String(m.from || '').startsWith('whatsapp:')
        && digitsOnly(m.to) === myNumber)
      .sort((a, b) => new Date(a.date_created) - new Date(b.date_created));
    for (const m of msgs) {
      const id = `twilio-${m.sid}`;
      if (seen.has(id)) continue;
      if (markOnly) continue; // al arrancar: solo marcar como vistos, no reprocesar
      const from = String(m.from).replace(/^whatsapp:/, '');
      const body = (m.body || '').trim();
      if (!from || !body) continue;
      if (/^join\s/i.test(body)) continue; // mensajes de unión al sandbox, ignorar
      console.log(`Poll Twilio: nuevo mensaje de ${from}`);
      try { await handleText(from, body, id, sendTwilio); }
      catch (e) { console.error('Error procesando mensaje:', e.message); }
    }
    // Evitar que la memoria de vistos crezca sin límite
    if (seen.size > 2000) {
      const it = seen.values();
      for (let i = 0; i < 1000; i++) seen.delete(it.next().value);
    }
  } catch (e) {
    console.error('Error en poll Twilio:', e.message);
  } finally {
    twilioPolling = false;
  }
}

app.get('/health', (req, res) => {
  res.send('ok');
  if (HAS_TWILIO) pollTwilio(false); // cada visita también revisa mensajes nuevos
});

app.listen(PORT, () => {
  console.log(`Bot WhatsApp -> Sheets en el puerto ${PORT} (Meta: ${HAS_META ? 'sí' : 'no'}, Twilio: ${HAS_TWILIO ? 'sí' : 'no'})`);
  if (HAS_TWILIO) {
    pollTwilio(true).then(() => {
      console.log(`Poll Twilio activo cada ${TWILIO_POLL_MS / 1000}s`);
      setInterval(() => pollTwilio(false), TWILIO_POLL_MS);
    });
  }
});
