// server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const { convertirMp4AMp3 } = require("./helpers/media");
const { transcribirAssemblyAI } = require("./helpers/assembly");

const app = express();
const PORT = process.env.PORT || 3000;

// ====== Configuración general ======
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

// ====== Utilidad de log ======
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

// ====== Configuración de almacenamiento de archivos ======
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, Date.now() + "_" + file.originalname),
});
const upload = multer({ storage });

// ====== Endpoints ======

// Raíz y health check
app.get("/", (req, res) => res.send("Servidor funcionando correctamente desde Railway."));
app.get("/health", (req, res) => res.json({ ok: true, service: "backend", port: PORT }));

// ====== Paso 2: Recepción de MP4 y conversión a MP3 ======
app.post("/transcribir", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el archivo 'video' (.mp4)" });

    const mp4Path = req.file.path;
    const base = path.parse(mp4Path).name;
    appendLog(`Paso2: recibido MP4 -> ${mp4Path}`);

    // Conversión MP4 → MP3
    const { mp3Path } = await convertirMp4AMp3(mp4Path);
    appendLog(`Paso2: convertido a MP3 -> ${mp3Path}`);

    // (La transcripción se implementará en Paso 3)
    res.json({ ok: true, mp4Path, mp3Path, base });
  } catch (err) {
    appendLog(`ERROR Paso2: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ====== Iniciar servidor ======
app.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
