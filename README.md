# Bot automático: WhatsApp → Hoja "Clientes"

Tú le escribes a un número de WhatsApp y el bot registra o actualiza solo al cliente en tu hoja de Google Sheets. Te responde confirmando, por ejemplo: "✅ Registrado: Zavala Ramos (Toyota Tundra 2020)."

**Lo que hace el bot:**
- Si reportas un cliente nuevo → agrega la fila con fecha de hoy, etapa "Nuevo".
- Si das el nombre de un cliente que ya existe → actualiza solo los datos que menciones (cita, etapa, teléfono, etc.) y pone la fecha de hoy en "Última actualización".
- Entiende texto libre: no necesitas formato. "pc" lo lee como "Por confirmar", "mañana" lo convierte en la fecha real.
- Si le mandas foto o audio → te pide que lo escribas en texto.

## Lo que necesitas (todo gratis)

1. **Llave de Groq** (la IA, 5 min) — la misma sirve para el puente de RingCentral.
2. **Cuenta de desarrollador de Meta + número de prueba de WhatsApp** (gratis, 20 min).
3. **Cuenta de servicio de Google** para que el bot pueda escribir en tu hoja (gratis, 10 min).
4. **Render** para correr el bot día y noche (gratis, 15 min).

Tu número personal NO se toca: el bot vive en el número de prueba de Meta y tú le escribes a ese número.

## Paso 1 — Llave de Groq (5 min)

1. Entra a console.groq.com/keys (crea cuenta si no tienes).
2. "Create API Key", cópiala. Empieza con `gsk_`.
3. Guárdala, la pegarás en el servidor al final. Nunca la pases por chat.

## Plan B — Twilio (si Meta te bloquea)

Si al pedir el número de prueba Meta dice que tu cuenta de WhatsApp Business está restringida, usa Twilio. Es otro servicio oficial, también gratis para empezar, y el bot ya habla con él: solo cambian las 3 variables de arriba.

**Paso 1 — Cuenta de Twilio (10 min, gratis)**
1. Entra a **twilio.com/try-twilio** y crea tu cuenta (te pide verificar tu teléfono por SMS).
2. Te regalan crédito de prueba; con eso basta para este bot.

**Paso 2 — Únete al número de pruebas de WhatsApp (2 min)**
1. En la consola de Twilio ve a **Messaging → Try it out → Send a WhatsApp message**.
2. Ahí verás un número (ej. +1 415 523 8886) y una palabra clave como `join <palabra>`.
3. Desde tu WhatsApp personal, mándale un mensaje a ese número con esa palabra. Listo: ya estás "dentro" del número de pruebas.

**Paso 3 — Conecta el bot (después del deploy)**
1. En esa misma pantalla del sandbox, en **"When a message comes in"**, pega: `https://tu-app.onrender.com/webhook/twilio` (método HTTP POST) y guarda.
2. En el `.env`/Render usa estas variables en vez de las de Meta:
   - `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN`: están en la página principal de tu consola de Twilio.
   - `TWILIO_WHATSAPP_FROM`: `whatsapp:+14155238886` (el número del sandbox).
3. Prueba: mándale un WhatsApp al número del sandbox con `Nuevo: Prueba Uno, 7135550000` → el bot responde ✅ y la fila aparece en tu hoja.

> Notas honestas: la cuenta de prueba de Twilio solo puede escribirle a números verificados (el tuyo lo verificas al registrarte, y tú eres el único que usará el bot). Cada mensaje cuesta una fracción de centavo de tu crédito gratis.

## Paso 2 — Meta y el número de WhatsApp (20 min)

1. Entra a developers.facebook.com e inicia sesión con tu Facebook.
2. Crea una App: "Create App" → tipo **Business** → ponle nombre "Clientes Bot".
3. En el panel de la App, busca **WhatsApp** y dale "Set up".
4. En **API Setup** verás un **número de prueba** que Meta te regala. Anota dos cosas:
   - **Phone number ID** (está debajo del número)
   - **Token temporal** (dura 24 h; abajo te digo cómo hacer uno permanente)
5. Agrega tu número como destinatario de prueba: en el campo "To" pon tu número con código de país (ej. +58... si es tu número de Venezuela) y envíate el código de verificación que te llega por WhatsApp. Acéptalo.
6. **Token permanente** (para no renovarlo cada día): en el panel ve a **Business Settings → Users → System Users** → crea uno, dale el permiso `whatsapp_business_messaging`, genera un token y cópialo. Ese es tu `WHATSAPP_TOKEN`.

## Paso 3 — Cuenta de servicio de Google (10 min)

El bot necesita permiso para escribir en tu hoja, y eso se hace con una "cuenta de servicio" (un usuario robot de Google):

1. Entra a console.cloud.google.com → crea un proyecto nuevo ("clientes-bot").
2. **APIs & Services → Library** → busca "Google Sheets API" → **Enable**.
3. **IAM & Admin → Service Accounts** → "Create Service Account" → nombre "clientes-bot" → crear (sin roles) → listo.
4. Entra a la cuenta creada → **Keys** → "Add Key" → **JSON** → se descarga un archivo.
5. Abre tu hoja **Clientes** → **Compartir** → pega el correo de la cuenta de servicio (termina en `@...iam.gserviceaccount.com`) → rol **Editor** → enviar.
6. Ese archivo JSON descargado se llamará `cuenta-servicio.json` junto al código en el servidor.

## Paso 4 — Subir el bot a Render (15 min)

1. Sube esta carpeta a un repositorio de GitHub (puedes arrastrar los archivos en github.com/new).
2. Entra a render.com → **New → Web Service** → conecta tu repo.
3. Build Command: `npm install` · Start Command: `npm start`.
4. En **Environment**, agrega estas variables (los valores los tienes de los pasos 1–3):
   - Si usas el **Plan B (Twilio)**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (están en la página principal de tu consola de Twilio) y `TWILIO_WHATSAPP_FROM` → `whatsapp:+14155238886` (el número del sandbox). No pongas las variables de Meta.
   - Si usas el **Plan A (Meta)**: `WHATSAPP_VERIFY_TOKEN` → inventa una clave larga, ej. `mi_clave_secreta_9273`, más `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.
   - Siempre: `LLM_API_KEY` (la de Groq, empieza con `gsk_`)
   - `SHEET_ID` → `14BMqQn2gV1Y467a660QKauTEqBhwpJbudm6te45_-6Y` (ya viene en el ejemplo)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` → `./cuenta-servicio.json` (así, tal cual; el archivo lo subes en el paso 5)
5. Sube la llave de Google como **Secret File** — no va en el repositorio: en la misma página de **Environment**, baja a **Secret Files** → **+ Add Secret File** → Filename: `cuenta-servicio.json` → en **Contents** pega TODO el contenido del archivo JSON que descargaste en el paso 3 → **Save Changes**. Render lo guarda solo en el servidor y el bot lo lee como `./cuenta-servicio.json`. Nunca subas este archivo a GitHub: es una llave privada.
6. Dale **Deploy**. Cuando termine, copia la URL: `https://tu-app.onrender.com`.

> Nota honesta: el plan gratis de Render "duerme" el servidor si no se usa. El primer mensaje del día puede tardar ~50 segundos en responder; los siguientes llegan al instante.
>
> Truco a $0 para que nunca se duerma: crea una cuenta gratis en **UptimeRobot** (uptimerobot.com), agrega un monitor **HTTP(s)** que visite `https://tu-app.onrender.com/health` cada 5 minutos. El bot ya tiene ese endpoint (`/health`) y responde "ok" — el monitor lo mantiene despierto 24/7.
>
> ⚠️ Importante: haz esto ANTES del paso 5. Meta verifica tu webhook con una solicitud rápida; si Render está dormido en ese momento, la verificación de "Verify and save" falla y hay que repetirla. Con el monitor activo desde ya, el paso 5 pasa a la primera.

## Paso 5 — Conectar el webhook y probar (10 min)

1. En tu App de Meta: **WhatsApp → Configuration → Webhook** → "Edit".
2. **Callback URL**: `https://tu-app.onrender.com/webhook/whatsapp`
3. **Verify token**: la misma clave que pusiste en `WHATSAPP_VERIFY_TOKEN`.
4. "Verify and save". Luego en **Webhook fields** suscríbete a **messages**.
5. **Prueba real**: desde tu teléfono, mándale un WhatsApp al número de prueba:
   `Nuevo: Prueba Uno, 7135550000, interesado en la Camry 2019`
   El bot debe responderte "✅ Registrado: Prueba Uno..." y la fila aparece en tu hoja. Borra esa fila de prueba después.

## Si algo falla

- **Meta dice "verify token mismatch"** → la clave del paso 5 no es igual a la del `.env`/Render. Deben ser idénticas.
- **El bot no responde nada** → revisa en Render los **Logs**; lo más común es que el campo `messages` no quedó suscrito en el webhook.
- **"No pude abrir la hoja"** → la hoja no está compartida con el correo de la cuenta de servicio (paso 3.5).
- **La IA no responde** → la llave de Groq está mal copiada.
- **Nunca** pegues tokens ni llaves en el chat ni en WhatsApp. Van solo en las variables del servidor.

## Más adelante

Cuando quieras dejar el número de prueba y usar un número real solo para el bot: en Meta agregas tu propio número (uno que **no** esté registrado en la app de WhatsApp), lo verificas por SMS y cambias el `WHATSAPP_PHONE_NUMBER_ID`. El código no cambia.
