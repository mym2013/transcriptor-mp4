// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express(); // instancia de Express

// === Servir frontend estático ===
app.use(express.static("public"));

// === Middlewares ===
app.use(cors());
app.use(express.json());

// === Configuración de multer para subir MP4 ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    cb(null, `${uniqueSuffix}_${safeName}`);
  },
});
const upload = multer({ storage });

// === Helpers ===
const {
  createTranscriptionJob,
  waitForCompletion,
  getTranscriptText,
} = require("./helpers/assemblyai");

const { convertirMp4AMp3 } = require("./helpers/media");

// === Endpoint principal: /transcribir ===
app.post("/transcribir", upload.single("video"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const outputDir =
      req.body.outputDir?.trim() ||
      process.env.OUTPUT_DIR ||
      "D:\\repos\\transcriptor-mp4\\output";

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const baseName = path.parse(filePath).name;
    const mp3Path = path.join(outputDir, `${baseName}.mp3`);

    // 1️⃣ Convertir MP4 a MP3
    await convertirMp4AMp3(filePath, mp3Path);

    // 2️⃣ Crear job de transcripción
    const job = await createTranscriptionJob(mp3Path);

    // 3️⃣ Esperar resultado y obtener texto
    await waitForCompletion(job.id);
    const transcriptText = await getTranscriptText(job.id);

    // 4️⃣ Guardar TXT
    const transcriptTxtPath = path.join(
      outputDir,
      `${baseName}_transcripcion.txt`
    );
    fs.writeFileSync(transcriptTxtPath, transcriptText, "utf-8");

    // 5️⃣ (opcional) resumen local
    const generarResumen =
      req.body.generarResumen === "on" || req.body.generarResumen === true;
    let summaryTxtPath = null;
    if (generarResumen) {
      const resumen = `Resumen automático:\n${transcriptText
        .split(" ")
        .slice(0, 80)
        .join(" ")} ...`;
      summaryTxtPath = path.join(outputDir, `${baseName}_resumen.txt`);
      fs.writeFileSync(summaryTxtPath, resumen, "utf-8");
    }

    return res.json({
      ok: true,
      mp4Path: filePath,
      mp3Path,
      transcriptTxtPath,
      summaryTxtPath,
      outputDir,
    });
  } catch (err) {
    console.error("Error en /transcribir:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// === Endpoint de resumen manual (si existe en backend previo) ===
app.post("/resumir", async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto) return res.status(400).json({ ok: false, error: "Sin texto" });
    const resumen = texto.split(" ").slice(0, 100).join(" ") + " ...";
    return res.json({ ok: true, resumen });
  } catch (err) {
    console.error("Error en /resumir:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// === Inicializar servidor ===
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {

  console.log(`Servidor backend activo en http://localhost:${PORT}`);
});
