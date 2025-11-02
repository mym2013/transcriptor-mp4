// server.js — CAP 11 estable con transcripción activa (AssemblyAI)
// Incluye require('dotenv'), validación MP4, yt-dlp, ffmpeg y fix ENOENT.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const multer = require("multer");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3001;
const AAI_KEY = process.env.ASSEMBLYAI_API_KEY || "";

console.log(`[CAP11] AAI key cargada: ${AAI_KEY ? "SÍ" : "NO"}`);

// ===== Middlewares =====
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// ===== Directorios =====
const OUTPUT_ROOT = path.join(__dirname, "output");
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/output", express.static(OUTPUT_ROOT));

// ===== Multer: subida temporal =====
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]+/g, "_");
    const stamp = Date.now();
    cb(null, `${stamp}_${safe}`);
  },
});
const upload = multer({ storage });

// ===== Helpers =====
function exists(p) {
  try { return p && fs.existsSync(p); } catch { return false; }
}
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function moveTo(src, destDir) {
  if (!exists(src)) return null;
  ensureDirSync(destDir);
  const dst = path.join(destDir, path.basename(src));
  try {
    fs.renameSync(src, dst);
    return dst;
  } catch {
    return null;
  }
}
function toPublicUrl(absPath) {
  if (!absPath) return null;
  const rel = path.relative(OUTPUT_ROOT, absPath).replace(/\\/g, "/");
  return `/output/${rel}`;
}
function spawnOnce(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "inherit", ...options });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} terminó con código ${code}`));
    });
  });
}

// ===== yt-dlp + ffmpeg =====
async function downloadYoutubeToMp4(url) {
  const stamp = Date.now();
  const outBase = path.join(UPLOADS_DIR, `${stamp}_video.mp4`);
  await spawnOnce("yt-dlp", ["-f", "mp4", "-o", outBase, url]);
  return outBase;
}
async function convertMp4ToMp3(mp4Path) {
  const mp3Path = path.join(UPLOADS_DIR, path.basename(mp4Path, ".mp4") + ".mp3");
  await spawnOnce("ffmpeg", ["-y", "-i", mp4Path, "-vn", "-acodec", "libmp3lame", mp3Path]);
  return mp3Path;
}

// ===== AssemblyAI =====
async function aaiUpload(filePath) {
  const stream = fs.createReadStream(filePath);
  const resp = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: AAI_KEY },
    body: stream,
    duplex: "half",
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`AAI upload HTTP ${resp.status} ${resp.statusText} — ${t}`);
  }
  const txt = await resp.text();
  try {
    const j = JSON.parse(txt);
    if (j && j.upload_url) return j.upload_url;
  } catch { }
  return txt.trim();
}

async function aaiTranscribeFromUrl(audioUrl) {
  const create = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: AAI_KEY, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, language_code: "es" }),
  });
  if (!create.ok) {
    const t = await create.text().catch(() => "");
    throw new Error(`AAI transcript HTTP ${create.status} ${create.statusText} — ${t}`);
  }
  const job = await create.json();
  const id = job.id;
  console.log(`[CAP11] AAI job creado: ${id}`);

  while (true) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: AAI_KEY },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`AAI poll HTTP ${r.status} ${r.statusText} — ${t}`);
    }
    const js = await r.json();
    if (js.status === "completed") {
      console.log(`[CAP11] AAI completado: ${id}`);
      return js.text || "";
    }
    if (js.status === "error") {
      throw new Error(`AAI error ${id} — ${js.error || "desconocido"}`);
    }
  }
}

// ===== Endpoint principal =====
app.post("/transcribir", upload.single("video"), async (req, res) => {
  try {
    const file = req.file || null;
    const url = (req.body?.url || "").trim();

    if (file) {
      const ext = path.extname(file.originalname).toLowerCase();
      const mime = (file.mimetype || "").toLowerCase();
      if (ext !== ".mp4" || !mime.includes("video")) {
        return res.status(400).json({ ok: false, error: "Formato inválido. Solo video .mp4" });
      }
    }

    let mp4Path = null;
    if (file) {
      mp4Path = path.resolve(file.path);
    } else if (url) {
      mp4Path = await downloadYoutubeToMp4(url);
    } else {
      return res.status(400).json({ ok: false, error: "No se recibió archivo ni URL." });
    }

    // === Conversión a MP3 ===
    let mp3Path = null;
    try {
      mp3Path = await convertMp4ToMp3(mp4Path);
    } catch (e) {
      console.error("[CAP11] Error FFmpeg:", e.message);
      return res.status(500).json({ ok: false, error: "Fallo conversión MP4→MP3 (ffmpeg)." });
    }

    // === Transcripción AssemblyAI ===
    let transcriptText = null, transcriptTxtPath = null, transcribeError = null;
    if (AAI_KEY) {
      try {
        const uploadUrl = await aaiUpload(mp3Path);
        transcriptText = await aaiTranscribeFromUrl(uploadUrl);
        transcriptTxtPath = path.join(
          UPLOADS_DIR,
          path.basename(mp3Path, ".mp3") + "_transcripcion.txt"
        );
        await fsp.writeFile(transcriptTxtPath, transcriptText, "utf8");
        console.log(`[CAP11] Transcripción guardada en ${transcriptTxtPath}`);
      } catch (e) {
        transcribeError = e?.message || String(e);
        console.error("[CAP11] Error AssemblyAI:", transcribeError);
      }
    } else {
      transcribeError = "ASSEMBLYAI_API_KEY no definida";
    }

    // === (Resumen pendiente) ===
    let summaryText = null, summaryTxtPath = null;

    // === Mover artefactos a /output
    const finalMp4 = moveTo(mp4Path, OUTPUT_ROOT);
    const finalMp3 = moveTo(mp3Path, OUTPUT_ROOT);
    const finalTr = moveTo(transcriptTxtPath, OUTPUT_ROOT);
    const finalSm = moveTo(summaryTxtPath, OUTPUT_ROOT);

    return res.json({
      ok: true,
      mp4Path: finalMp4 || (exists(mp4Path) ? mp4Path : null),
      mp3Path: finalMp3 || (exists(mp3Path) ? mp3Path : null),
      transcriptTxtPath: finalTr || (exists(transcriptTxtPath) ? transcriptTxtPath : null),
      summaryTxtPath: finalSm || (exists(summaryTxtPath) ? summaryTxtPath : null),
      mp4Url: finalMp4 ? toPublicUrl(finalMp4) : null,
      mp3Url: finalMp3 ? toPublicUrl(finalMp3) : null,
      transcriptUrl: finalTr ? toPublicUrl(finalTr) : null,
      summaryUrl: finalSm ? toPublicUrl(finalSm) : null,
      transcriptText,
      summaryText,
      transcribeError,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || "Error en /transcribir." });
  }
});

// ===== Inicio =====
app.listen(PORT, () => {
  console.log(`Servidor backend activo en http://localhost:${PORT}`);
});
