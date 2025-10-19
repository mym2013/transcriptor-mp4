// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const {
  createTranscriptionJob,
  waitForCompletion,
  getTranscriptText,
  // summarizeWithLeMUR, // no lo usamos en Cap 6
} = require("./helpers/assemblyai"); // helper real
const { convertirMp4AMp3 } = require("./helpers/media");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Configuración general
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

// ===== Log básico
const LOG_FILE = path.join(__dirname, "uploads", "logs.txt");
function appendLog(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const ts = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${ts}] ${line}\n`, "utf8");
  } catch (err) {
    console.error("log error:", err);
  }
}

// ===== Resumen local básico (2–3 oraciones)
function resumirBasico(text) {
  if (!text) return "";
  const oraciones = text
    .split(/(?<=[\.!\?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  const top = oraciones.slice(0, 3).join(" ");
  return top || text.slice(0, 400);
}

// ===== Almacenamiento de archivos
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, Date.now() + "_" + file.originalname),
});
const upload = multer({ storage });

// ===== Endpoints
app.get("/", (_req, res) =>
  res.send("Servidor funcionando correctamente desde Railway.")
);
app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "backend", port: PORT })
);

// ===== POST /transcribir (MP4 local → MP3 → AAI → TXT + log)
app.post("/transcribir", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el archivo 'video' (.mp4)" });

    const mp4Path = req.file.path;
    const base = path.parse(mp4Path).name;
    appendLog(`Paso2: recibido MP4 -> ${mp4Path}`);

    // MP4 → MP3
    const { mp3Path } = await convertirMp4AMp3(mp4Path);
    appendLog(`Paso2: convertido a MP3 -> ${mp3Path}`);

    // AssemblyAI (sin summarization del lado AAI)
    appendLog(`Paso3: creando job en AssemblyAI...`);
    const transcriptId = await createTranscriptionJob(mp3Path);
    appendLog(`Paso3: transcriptId=${transcriptId}, esperando...`);

    const done = await waitForCompletion(transcriptId, { intervalMs: 5000, maxMinutes: 30 });
    appendLog(`Paso3: estado final=${done.status}`);

    // Obtenemos el texto (solo texto; el resumen lo hacemos local)
    const { text } = await getTranscriptText(transcriptId);
    const finalSummary = resumirBasico(text);

    // Guardado TXT
    const transcriptTxtPath = path.join(UPLOAD_DIR, `${base}_transcripcion.txt`);
    const summaryTxtPath = path.join(UPLOAD_DIR, `${base}_resumen.txt`);
    fs.writeFileSync(transcriptTxtPath, text || "", "utf8");
    fs.writeFileSync(summaryTxtPath, finalSummary || "", "utf8");
    appendLog(`Paso3: TXT -> ${transcriptTxtPath} | ${summaryTxtPath}`);

    return res.json({
      ok: true,
      mp4Path,
      mp3Path,
      transcriptId,
      transcriptTxtPath,
      summaryTxtPath,
      lengths: { text: (text || "").length, summary: (finalSummary || "").length },
    });
  } catch (err) {
    appendLog(`ERROR /transcribir: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// ===== Start
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
