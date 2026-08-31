// server.js — Transcripción AssemblyAI + Resumen LLM (DeepSeek) + frontend CAP B1
// CAP12: soporte de AUDIO directo (mp3/wav/m4a) + video mp4 + URL

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const multer = require("multer");
const { spawn } = require("child_process");
const { buildExecutiveSummaryPrompt } = require("./helpers/prompts");

// fetch (Node 18+ ya lo trae; para Node <18 usamos node-fetch dinámico)
let fetch = global.fetch;
if (!fetch) {
  fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

// ===== Config básica =====
const app = express();
const PORT = process.env.PORT || 3001;
const AAI_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

console.log(`[CAP11] AAI key cargada: ${AAI_KEY ? "SÍ" : "NO"}`);
console.log(`[Resumen] Modo LLM (DeepSeek: ${DEEPSEEK_MODEL})`);

// ===== Middlewares =====
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static("public"));

// ===== Directorios =====
const OUTPUT_ROOT = path.join(__dirname, "output");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const TOOLS_DIR = path.join(__dirname, "herramientas");
const YT_DLP_PATH = path.join(TOOLS_DIR, "yt-dlp.exe");

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
    let stdout = "";
    let stderr = "";

    const p = spawn(bin, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (p.stdout) {
      p.stdout.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);
      });
    }

    if (p.stderr) {
      p.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });
    }

    p.on("error", (err) => {
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });

    p.on("close", (code) => {
      if (code === 0) {
        return resolve({
          code,
          stdout,
          stderr,
        });
      }

      const error = new Error(`${bin} salió con código ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;

      reject(error);
    });
  });
}

// ===== Resumen LOCAL (extractivo básico, fallback sin LLM) =====
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

// ===== Resumen LLM (DeepSeek) =====
async function generateLLMSummary(transcriptText) {
  if (!transcriptText || typeof transcriptText !== "string") return null;
  if (!DEEPSEEK_KEY) {
    throw new Error("DEEPSEEK_API_KEY no configurada.");
  }

  const prompt = buildExecutiveSummaryPrompt(transcriptText);

  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`DeepSeek error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

async function generateSummaryWithFallback(transcriptText) {
  try {
    const summary = await generateLLMSummary(transcriptText);
    if (!summary) throw new Error("DeepSeek respondió sin contenido.");

    console.log(`[Resumen] Generado con DeepSeek (${DEEPSEEK_MODEL}).`);
    return { text: summary, mode: "deepseek", error: null };
  } catch (err) {
    const reason = err.message || String(err);
    console.warn(`[Resumen] DeepSeek no disponible: ${reason}`);
    console.warn("[Resumen] Usando fallback local.");

    return {
      text: makeLocalSummary(transcriptText),
      mode: "local",
      error: reason,
    };
  }
}

// ===== yt-dlp y ffmpeg =====
async function inspectYoutubeUrl(url) {
  console.log("[YouTube] Detectando tipo de contenido...");

  try {
    const result = await spawnOnce(
      YT_DLP_PATH,
      [
        "--js-runtimes",
        "node",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        url,
      ],
      { windowsHide: true }
    );

    const info = JSON.parse(result.stdout.trim());
    const liveStatus = info?.live_status || null;

    const isLive = info?.is_live === true || liveStatus === "is_live";
    const wasLive = info?.was_live === true || liveStatus === "was_live";
    const isUpcoming = liveStatus === "is_upcoming";

    console.log(
      `[YouTube] Tipo detectado: ${
        isLive
          ? "LIVE"
          : isUpcoming
          ? "LIVE PROGRAMADO"
          : wasLive
          ? "LIVE FINALIZADO / VIDEO PUBLICADO"
          : "VIDEO PUBLICADO"
      }`
    );

    return { isLive, wasLive, isUpcoming, liveStatus };
  } catch (err) {
    console.warn("[YouTube] No se pudo inspeccionar previamente la URL; se usará flujo normal.");
    return {
      isLive: false,
      wasLive: false,
      isUpcoming: false,
      liveStatus: null,
    };
  }
}

function youtubeErrorDetails(err) {
  return `${err?.stderr || ""}
${err?.stdout || ""}`.toLowerCase();
}

function throwYoutubeDownloadError(err) {
  const details = youtubeErrorDetails(err);

  if (details.includes("http error 429") || details.includes("too many requests")) {
    throw new Error(
      "YouTube bloqueó temporalmente la descarga por exceso de solicitudes (HTTP 429)."
    );
  }

  if (
    details.includes("sign in to confirm") ||
    details.includes("not a bot") ||
    details.includes("use --cookies")
  ) {
    throw new Error(
      "YouTube exige autenticación para esta descarga. Debes usar cookies válidas de una sesión iniciada."
    );
  }

  if (details.includes("requested format is not available")) {
    throw new Error("YouTube no entregó un formato compatible para este video.");
  }

  throw new Error(
    `Fallo al descargar el video desde YouTube: ${err.message || "error desconocido"}`
  );
}

function canFallbackFromLiveFromStart(err) {
  const details = youtubeErrorDetails(err);

  return (
    details.includes("live-from-start") ||
    details.includes("live from start") ||
    details.includes("dvr") ||
    details.includes("beginning of the live stream") ||
    details.includes("cannot download from the start") ||
    details.includes("fragment")
  );
}

async function downloadYoutubeToMp4(url) {
  const stamp = Date.now();
  const outBase = path.join(UPLOADS_DIR, `${stamp}_video.mp4`);
  const info = await inspectYoutubeUrl(url);

  if (info.isUpcoming) {
    throw new Error("La transmisión de YouTube todavía no ha comenzado.");
  }

  if (!info.isLive) {
    console.log("[YouTube] Descargando video publicado.");

    try {
      await spawnOnce(YT_DLP_PATH, [
        "--js-runtimes",
        "node",
        "-f",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        outBase,
        url,
      ]);

      return {
        path: outBase,
        youtubeType: "published",
        dvrAvailable: null,
        downloadedFromStart: null,
      };
    } catch (err) {
      throwYoutubeDownloadError(err);
    }
  }

  console.log("[YouTube Live] Live detectado.");
  console.log("[YouTube Live] Intentando descarga desde el inicio con --live-from-start.");
  console.log("[YouTube Live] Esperando fin de transmisión...");

  try {
    await spawnOnce(YT_DLP_PATH, [
      "--js-runtimes",
      "node",
      "--live-from-start",
      "-f",
      "bv*+ba/b",
      "--merge-output-format",
      "mp4",
      "-o",
      outBase,
      url,
    ]);

    console.log("[YouTube Live] Transmisión terminada.");
    console.log("[YouTube Live] DVR disponible: SÍ.");
    console.log("[YouTube Live] Descarga completada desde el inicio.");

    return {
      path: outBase,
      youtubeType: "live",
      dvrAvailable: true,
      downloadedFromStart: true,
    };
  } catch (err) {
    if (!canFallbackFromLiveFromStart(err)) {
      throwYoutubeDownloadError(err);
    }

    console.warn("[YouTube Live] DVR no disponible o --live-from-start no utilizable.");
    console.warn("[YouTube Live] Continuando desde el punto actual.");
    console.log("[YouTube Live] Esperando fin de transmisión...");

    try {
      await spawnOnce(YT_DLP_PATH, [
        "--js-runtimes",
        "node",
        "-f",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        outBase,
        url,
      ]);

      console.log("[YouTube Live] Transmisión terminada.");
      console.log("[YouTube Live] Descarga completada desde el punto disponible.");

      return {
        path: outBase,
        youtubeType: "live",
        dvrAvailable: false,
        downloadedFromStart: false,
      };
    } catch (fallbackErr) {
      throwYoutubeDownloadError(fallbackErr);
    }
  }
}

async function convertMp4ToMp3(mp4Path) {
  const mp3Path = path.join(UPLOADS_DIR, path.basename(mp4Path, ".mp4") + ".mp3");
  await spawnOnce("ffmpeg", ["-y", "-i", mp4Path, "-vn", "-acodec", "libmp3lame", mp3Path]);
  return mp3Path;
}

// CAP12: AUDIO → MP3 (si ya es mp3, no convierte)
async function convertAudioToMp3(inputAudioPath) {
  const ext = path.extname(inputAudioPath).toLowerCase();

  if (ext === ".mp3") return inputAudioPath;

  const mp3Path = path.join(UPLOADS_DIR, path.basename(inputAudioPath, ext) + ".mp3");

  await spawnOnce("ffmpeg", ["-y", "-i", inputAudioPath, "-acodec", "libmp3lame", mp3Path]);

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
    throw new Error(`AAI transcript HTTP ${create.status} ${create.statusText} — ${t}`);
  }

  const job = await create.json();
  const id = job.id;

  console.log(`[AAI] Job creado: ${id}`);

  while (true) {
    await new Promise((res) => setTimeout(res, 2500));

    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: AAI_KEY },
    });

    if (!poll.ok) {
      const t = await poll.text().catch(() => "");
      throw new Error(`AAI poll HTTP ${poll.status} ${poll.statusText} — ${t}`);
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
// CAP12: ahora acepta video (mp4) o audio (mp3/wav/m4a) o url
app.post(
  "/transcribir",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const videoFile = req.files?.video?.[0] || null;
      const audioFile = req.files?.audio?.[0] || null;
      const url = (req.body?.url || "").trim();

      // Validación mínima de presencia
      if (!audioFile && !videoFile && !url) {
        return res.status(400).json({ ok: false, error: "No se recibió archivo (audio/video) ni URL." });
      }

      // Validación archivo VIDEO MP4 (si viene)
      if (videoFile) {
        const ext = path.extname(videoFile.originalname).toLowerCase();
        const mime = (videoFile.mimetype || "").toLowerCase();
        if (ext !== ".mp4" || !mime.includes("video")) {
          return res.status(400).json({ ok: false, error: "Formato inválido en video. Solo MP4." });
        }
      }

      // Validación archivo AUDIO (si viene)
      if (audioFile) {
        const ext = path.extname(audioFile.originalname).toLowerCase();
        const mime = (audioFile.mimetype || "").toLowerCase();

        const allowedExt = new Set([".mp3", ".wav", ".m4a"]);
        const mimeOk =
          mime.startsWith("audio/") ||
          mime.includes("mpeg") ||
          mime.includes("wav") ||
          mime.includes("mp4");

        if (!allowedExt.has(ext) || !mimeOk) {
          return res.status(400).json({ ok: false, error: "Formato inválido en audio. Solo MP3/WAV/M4A." });
        }
      }

      // Priorización temporal (regla final se define luego): audio > video > url
      const sourceType = audioFile ? "audio" : videoFile ? "video" : "url";

      let mp4Path = null;
      let mp3Path = null;
      let youtubeType = null;
      let dvrAvailable = null;
      let downloadedFromStart = null;

      if (audioFile) {
        const audioPath = path.resolve(audioFile.path);
        try {
          mp3Path = await convertAudioToMp3(audioPath);
        } catch (e) {
          console.error("[FFMPEG] Error:", e.message);
          return res.status(500).json({ ok: false, error: "Fallo conversión AUDIO→MP3." });
        }
      } else {
        if (videoFile) {
          mp4Path = path.resolve(videoFile.path);
        } else if (url) {
          const youtubeResult = await downloadYoutubeToMp4(url);
          mp4Path = youtubeResult.path;
          youtubeType = youtubeResult.youtubeType;
          dvrAvailable = youtubeResult.dvrAvailable;
          downloadedFromStart = youtubeResult.downloadedFromStart;
        }

        if (!mp4Path) {
          return res.status(400).json({ ok: false, error: "No se pudo obtener MP4 desde archivo o URL." });
        }

        try {
          mp3Path = await convertMp4ToMp3(mp4Path);
        } catch (e) {
          console.error("[FFMPEG] Error:", e.message);
          return res.status(500).json({ ok: false, error: "Fallo conversión MP4→MP3." });
        }
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

          transcriptTxtPath = path.join(UPLOADS_DIR, path.basename(mp3Path, ".mp3") + "_transcripcion.txt");
          await fsp.writeFile(transcriptTxtPath, transcriptText, "utf8");
          console.log(`[AAI] Transcripción guardada en ${transcriptTxtPath}`);
        } catch (err) {
          transcribeError = err.message || String(err);
          console.error("[AAI] Error:", transcribeError);
        }
      }

      // === Resumen LLM + fallback local ===
      let summaryMode = null;
      let summaryError = null;

      if (transcriptText) {
        const summaryResult = await generateSummaryWithFallback(transcriptText);
        summaryText = summaryResult.text;
        summaryMode = summaryResult.mode;
        summaryError = summaryResult.error;

        if (summaryText) {
          summaryTxtPath = path.join(UPLOADS_DIR, path.basename(mp3Path, ".mp3") + "_resumen.txt");
          await fsp.writeFile(summaryTxtPath, summaryText, "utf8");
          console.log(`[Resumen] Guardado en ${summaryTxtPath}`);
        }
      }

      // === Mover artefactos a output/ ===
      const finalMp4 = moveTo(mp4Path, OUTPUT_ROOT); // puede ser null (si sourceType=audio)
      const finalMp3 = moveTo(mp3Path, OUTPUT_ROOT);
      const finalTr = moveTo(transcriptTxtPath, OUTPUT_ROOT);
      const finalSm = summaryTxtPath ? moveTo(summaryTxtPath, OUTPUT_ROOT) : null;

      return res.json({
        ok: true,
        message: "Proceso completado (AssemblyAI + resumen).",
        sourceType,
        youtubeType,
        dvrAvailable,
        downloadedFromStart,
        mp4Url: finalMp4 ? toPublicUrl(finalMp4) : null,
        mp3Url: finalMp3 ? toPublicUrl(finalMp3) : null,
        transcriptUrl: finalTr ? toPublicUrl(finalTr) : null,
        summaryUrl: finalSm ? toPublicUrl(finalSm) : null,
        transcriptText,
        summaryText,
        summaryMode,
        transcribeError,
        summaryError,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Error en /transcribir.",
      });
    }
  }
);

// ===== Inicio servidor =====
app.listen(PORT, () => {
  console.log(`Servidor backend activo en http://localhost:${PORT}`);
});
