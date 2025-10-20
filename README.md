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
