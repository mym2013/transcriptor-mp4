// server.js — Transcripción AssemblyAI + Resumen LOCAL (sin OpenAI) + frontend CAP B1

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const multer = require("multer");
const { spawn } = require("child_process");

// ===== Config básica =====
const app = express();
const PORT = process.env.PORT || 3001;
const AAI_KEY = process.env.ASSEMBLYAI_API_KEY || "";

console.log(`[CAP11] AAI key cargada: ${AAI_KEY ? "SÍ" : "NO"}`);
console.log(`[Resumen] Modo LOCAL (sin OpenAI, sin costo)`);

// ===== Middlewares =====
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static("public"));

// ===== Directorios =====
const OUTPUT_ROOT = path.join(__dirname, "output");
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use("/output", express.static(OUTPUT_ROOT));

// ===== Multer =====
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const stamp = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${stamp}_${safe}`);
  },
});
const upload = multer({ storage });

// ===== Helpers =====
function exists(p) {
  try {
    return p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function moveTo(src, destDir) {
  if (!exists(src)) return null;
  ensureDirSync(destDir);
  const final = path.join(destDir, path.basename(src));
  try {
    fs.renameSync(src, final);
    return final;
  } catch (err) {
    console.error("[moveTo] Error moviendo archivo:", err.message || err);
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
    p.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${bin} salió con código ${code}`));
    });
  });
}

// ===== Resumen LOCAL (extractivo básico, sin IA externa) =====
// Toma las frases más representativas según frecuencia de palabras
function makeLocalSummary(text, maxSentences = 8) {
  if (!text || typeof text !== "string") return null;

  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const rawSentences = cleaned.split(/(?<=[.!?¡¿])\s+/);
  const sentences = rawSentences.filter((s) => s && s.length > 20);

  if (sentences.length === 0) return null;

  const freq = Object.create(null);
  for (const s of sentences) {
    const words = s
      .toLowerCase()
      .replace(/[^a-záéíóúüñ0-9\s]/gi, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  const scored = sentences.map((s, idx) => {
    const words = s
      .toLowerCase()
      .replace(/[^a-záéíóúüñ0-9\s]/gi, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    let score = 0;
    for (const w of words) score += freq[w] || 0;
    return { idx, sentence: s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(maxSentences, scored.length));
  top.sort((a, b) => a.idx - b.idx);

  return top.map((x) => x.sentence.trim()).join(" ");
}

// ===== yt-dlp y ffmpeg =====
async function downloadYoutubeToMp4(url) {
  const stamp = Date.now();
  const outBase = path.join(UPLOADS_DIR, `${stamp}_video.mp4`);
  await spawnOnce("yt-dlp", ["-f", "mp4", "-o", outBase, url]);
  return outBase;
}

async function convertMp4ToMp3(mp4Path) {
  const mp3Path = path.join(
    UPLOADS_DIR,
    path.basename(mp4Path, ".mp4") + ".mp3"
  );
  await spawnOnce("ffmpeg", [
    "-y",
    "-i",
    mp4Path,
    "-vn",
    "-acodec",
    "libmp3lame",
    mp3Path,
  ]);
  return mp3Path;
}

// ===== AssemblyAI: upload + transcripción =====
async function aaiUpload(filePath) {
  const stream = fs.createReadStream(filePath);

  const resp = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: AAI_KEY },
    body: stream,
    duplex: "half",
  });

  const txt = await resp.text();

  if (!resp.ok) throw new Error(`AAI upload HTTP ${resp.status} — ${txt}`);

  return JSON.parse(txt).upload_url;
}

async function aaiTranscribe(audioUrl) {
  const create = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: AAI_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      language_code: "es",
    }),
  });

  if (!create.ok) {
    const t = await create.text().catch(() => "");
    throw new Error(
      `AAI transcript HTTP ${create.status} ${create.statusText} — ${t}`
    );
  }

  const job = await create.json();
  const id = job.id;

  console.log(`[AAI] Job creado: ${id}`);

  while (true) {
    await new Promise((res) => setTimeout(res, 2500));

    const poll = await fetch(
      `https://api.assemblyai.com/v2/transcript/${id}`,
      { headers: { authorization: AAI_KEY } }
    );

    if (!poll.ok) {
      const t = await poll.text().catch(() => "");
      throw new Error(
        `AAI poll HTTP ${poll.status} ${poll.statusText} — ${t}`
      );
    }

    const data = await poll.json();

    if (data.status === "completed") {
      console.log(`[AAI] Job completado: ${id}`);
      return data.text || "";
    }

    if (data.status === "error") {
      throw new Error(`AAI error: ${data.error || "desconocido"}`);
    }
  }
}

// ===== Endpoint principal: /transcribir =====
app.post("/transcribir", upload.single("video"), async (req, res) => {
  try {
    const file = req.file || null;
    const url = (req.body?.url || "").trim();

    // Validación archivo MP4
    if (file) {
      const ext = path.extname(file.originalname).toLowerCase();
      const mime = (file.mimetype || "").toLowerCase();
      if (ext !== ".mp4" || !mime.includes("video")) {
        return res
          .status(400)
          .json({ ok: false, error: "Formato inválido. Solo MP4." });
      }
    }

    let mp4Path = null;

    if (file) {
      mp4Path = path.resolve(file.path);
    } else if (url) {
      mp4Path = await downloadYoutubeToMp4(url);
    } else {
      return res
        .status(400)
        .json({ ok: false, error: "No se recibió archivo ni URL." });
    }

    // === MP4 → MP3 ===
    let mp3Path;
    try {
      mp3Path = await convertMp4ToMp3(mp4Path);
    } catch (e) {
      console.error("[FFMPEG] Error:", e.message);
      return res
        .status(500)
        .json({ ok: false, error: "Fallo conversión MP4→MP3." });
    }

    // === Transcripción AssemblyAI ===
    let transcriptText = null;
    let transcriptTxtPath = null;
    let summaryTxtPath = null;
    let summaryText = null;
    let transcribeError = null;

    if (AAI_KEY) {
      try {
        const uploadUrl = await aaiUpload(mp3Path);
        transcriptText = await aaiTranscribe(uploadUrl);

        transcriptTxtPath = path.join(
          UPLOADS_DIR,
          path.basename(mp3Path, ".mp3") + "_transcripcion.txt"
        );
        await fsp.writeFile(transcriptTxtPath, transcriptText, "utf8");
        console.log(`[AAI] Transcripción guardada en ${transcriptTxtPath}`);
      } catch (err) {
        transcribeError = err.message || String(err);
        console.error("[AAI] Error:", transcribeError);
      }
    }

    // === Resumen LOCAL ===
    if (transcriptText) {
      summaryText = makeLocalSummary(transcriptText, 8);

      if (summaryText) {
        summaryTxtPath = path.join(
          UPLOADS_DIR,
          path.basename(mp3Path, ".mp3") + "_resumen.txt"
        );
        await fsp.writeFile(summaryTxtPath, summaryText, "utf8");
        console.log(`[Resumen LOCAL] Guardado en ${summaryTxtPath}`);
      }
    }

    // === Mover artefactos a output/ ===
    const finalMp4 = moveTo(mp4Path, OUTPUT_ROOT);
    const finalMp3 = moveTo(mp3Path, OUTPUT_ROOT);
    const finalTr = moveTo(transcriptTxtPath, OUTPUT_ROOT);
    const finalSm = moveTo(summaryTxtPath, OUTPUT_ROOT);

    return res.json({
      ok: true,
      message: "Proceso completado (AssemblyAI + resumen LOCAL).",
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
    return res.status(500).json({
      ok: false,
      error: err.message || "Error en /transcribir.",
    });
  }
});

// ===== Inicio servidor =====
app.listen(PORT, () => {
  console.log(`Servidor backend activo en http://localhost:${PORT}`);
});
