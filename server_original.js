const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { spawn } = require('child_process');
const sqlite3 = require('better-sqlite3');

// Inicializar base de datos SQLite
const db = new sqlite3('transcripciones.sqlite');
db.exec(`
  CREATE TABLE IF NOT EXISTS transcripciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    texto TEXT,
    fecha TEXT
  )
`);

const app = express();

// Middleware CORS con soporte para headers personalizados
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, x-access-key'
  );
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// Middleware para validar clave de acceso
app.use((req, res, next) => {
  const userKey = req.headers['x-access-key'];
  if (userKey !== process.env.ACCESS_KEY) {
    return res.status(401).json({ error: 'Clave de acceso no válida' });
  }
  next();
});

/**
 * ==============================
 * 🔹 Endpoint para Transcripción
 * ==============================
 */
app.post('/transcribir', async (req, res) => {
  const { url, usarCookies } = req.body;
  if (!url) return res.status(400).json({ error: 'URL no proporcionada' });

  const audioPath = path.join(__dirname, 'audio.mp3');
  console.log('✅ Descargando audio con yt-dlp...');

  const ytdlpArgs = [
    url,
    '--extract-audio',
    '--audio-format', 'mp3',
    '--force-overwrites',
    '--no-cache-dir',
    '-o', 'audio.mp3'
  ];

  if (usarCookies) {
    ytdlpArgs.splice(1, 0, '--cookies', 'cookies.txt');
  }

  const ytdlp = spawn('yt-dlp', ytdlpArgs);
  ytdlp.stdout.on('data', data => console.log(`yt-dlp stdout: ${data}`));
  ytdlp.stderr.on('data', data => console.error(`yt-dlp stderr: ${data}`));

  ytdlp.on('close', async code => {
    if (code !== 0) {
      console.error(`yt-dlp terminó con código ${code}`);
      return res.status(500).json({ error: 'Error al descargar audio' });
    }

    try {
      console.log('✅ Audio descargado correctamente.');
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const stats = fs.statSync(audioPath);
      if (stats.size > 25 * 1024 * 1024) {
        console.warn('⚠️ Audio supera los 25MB. Dividiendo con FFmpeg...');
        const tempDir = path.join(require('os').tmpdir(), 'chunks');
        fs.mkdirSync(tempDir, { recursive: true });

        const segmentCmd = [
          '-i', 'audio.mp3',
          '-f', 'segment',
          '-segment_time', '300',
          '-c', 'copy',
          path.join(tempDir, 'chunk_%03d.mp3')
        ];

        await new Promise((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', segmentCmd);
          ffmpeg.stdout.on('data', d => console.log(`ffmpeg: ${d}`));
          ffmpeg.stderr.on('data', d => console.log(`ffmpeg: ${d}`));
          ffmpeg.on('close', code => code === 0 ? resolve() : reject());
        });

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.mp3'));
        let fullText = '';

        for (const file of files) {
          console.log(`🔹 Transcribiendo fragmento: ${file}`);
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(path.join(tempDir, file)),
            model: 'whisper-1',
            response_format: 'text'
          });
          fullText += transcription + '\n';
        }

        fs.writeFileSync('transcripcion.txt', fullText.trim());

        db.prepare('INSERT INTO transcripciones (url, texto, fecha) VALUES (?, ?, ?)').run(
          url,
          fullText.trim(),
          new Date().toISOString()
        );

        return res.json({ transcripcion: fullText.trim() });
      }

      console.log('✅ Transcribiendo audio con Whisper...');
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        response_format: 'text'
      });

      fs.writeFileSync('transcripcion.txt', transcription);

      db.prepare('INSERT INTO transcripciones (url, texto, fecha) VALUES (?, ?, ?)').run(
        url,
        transcription,
        new Date().toISOString()
      );

      return res.json({ transcripcion: transcription });

    } catch (err) {
      console.error('Error al transcribir:', err);
      return res.status(500).json({ error: 'Error al transcribir el audio' });
    }
  });
});

/**
 * ===========================
 * 🔹 Endpoint para Resumir
 * ===========================
 */
app.post('/resumir', async (req, res) => {
  const { texto } = req.body;
  if (!texto) return res.status(400).json({ error: 'Texto no proporcionado' });

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente que crea resúmenes ejecutivos detallados de transcripciones. Quiero que generes un resumen estructurado y proporcional a la longitud del texto original.`
        },
        {
          role: 'user',
          content: texto
        }
      ]
    });

    res.json({ resumen: completion.choices[0].message.content });

  } catch (err) {
    console.error('Error al generar el resumen:', err);
    res.status(500).json({ error: 'Error al generar el resumen' });
  }
});

/**
 * ===========================
 * 🔹 Iniciar Servidor
 * ===========================
 */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));