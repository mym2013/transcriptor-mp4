# 🎧 Transcriptor MP4 → TXT (Backend MVP)

## 🧩 Descripción
Backend Node.js que convierte archivos MP4 a MP3 y obtiene transcripciones automáticas usando AssemblyAI.  
Optimizado para procesar clases largas (hasta 3 h o 500 MB) en español, generando además un resumen local.

---

## ⚙️ Flujo general

MP4 → MP3 (FFmpeg) → AssemblyAI → TXT + Resumen

**********************************************************************
### Funcionalidades
- ✅ Conversión automática a MP3 (mono, 16 kHz, 96 kbps)
- ✅ Validación de tamaño (≤ 500 MB)
- ✅ Control de idioma (`es` por defecto, con detección opcional)
- ✅ Generación de `.txt` y `.resumen.txt`
- ✅ Logging detallado del proceso

---

## 🚀 Uso rápido
```bash
npm install
npm run dev
**********************************************************************

curl -X POST "http://localhost:3001/transcribir" \
  -F "video=@uploads/clase1.mp4;type=video/mp4"

dev
**********************************************************************
uploads/
  ├── GestionAgil/
  │    ├── Clase1.mp4
  │    ├── Clase1_transcripcion.txt
  │    └── Clase1_resumen.txt
  └── DevOps/
       ├── Clase2.mp4
       ├── Clase2_transcripcion.txt
       └── Clase2_resumen.txt

Notas técnicas

FFmpeg requerido en PATH.

AssemblyAI API key en .env (ASSEMBLYAI_API_KEY=).

Límite gratuito: ~500 MB por audio.

Compatible con Windows y Railway/Vercel deploy.

🏁 Estado del proyecto

✅ MVP Backend estable (Capítulo 7 completado)
Próximo paso opcional: modo Whisper local (offline multilingüe)

🧑‍💻 Autor

Desarrollado por Gonzalo F. Torres del Fierro
2025 — Proyecto Transcriptor MP4

********************************************************************************************************************************************************************
## 📅 8 de Julio - Seguridad (Fase 1)

### 🎯 Objetivo
Cerrar vectores de ataque que exponían el servidor y generaban gastos no autorizados en AssemblyAI y DeepSeek.

### 🔧 Cambios Realizados

#### 1. Restricción de CORS
- **Antes:** `app.use(cors())` sin opciones (cualquier origen podía llamar a la API).
- **Ahora:** Solo permite peticiones desde el frontend autorizado.
- **Archivo:** `server.js`
- **Commit:** `[hash del commit]`

#### 2. Rate Limiting
- **Antes:** No había límite de peticiones (podían hacer 10,000/minuto).
- **Ahora:** Máximo 10 peticiones por minuto por IP (devuelve 429 si se excede).
- **Archivo:** `server.js`
- **Commit:** `[hash del commit]`

#### 3. Validación de URLs (Anti-SSRF)
- **Antes:** Cualquier URL era aceptada (incluyendo `http://localhost:3000/admin`).
- **Ahora:** Solo URLs con protocolo HTTP/HTTPS y dominio que resuelva a IP pública.
- **Archivo:** `utils/urlValidator.js` (nuevo archivo)
- **Commit:** `[hash del commit]`

### ✅ Pruebas Realizadas
- [x] CORS: Petición desde origen no autorizado devuelve error.
- [x] Rate Limit: 11ª petición en 1 minuto devuelve 429.
- [x] SSRF: URL con IP privada (localhost, 192.168.x.x) es rechazada.
- [x] URL válida: `https://youtube.com/watch?v=abc` pasa la validación.
- [x] URL válida: `https://facebook.com/watch?v=123` pasa la validación.
- [x] URL válida: `https://instagram.com/reel/xyz` pasa la validación.

### 📊 Impacto
- **Seguridad:** Se previene el abuso de la API y ataques SSRF.
- **Economía:** Se reducen gastos no autorizados en servicios de pago.
- **Estabilidad:** El servidor no procesa peticiones maliciosas.

********************************************************************************************************************************************************************