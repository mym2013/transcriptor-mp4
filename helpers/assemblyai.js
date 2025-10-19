// helpers/assemblyai.js
// Subir MP3 a AssemblyAI, crear transcripción (con resumen integrado),
// esperar a "completed" y devolver { text, summary }.
//
// Requisitos:
// - Node 18+ (fetch global)
// - Variable de entorno ASSEMBLYAI_API_KEY configurada

const fs = require("fs");
const path = require("path");

const AAI_BASE = "https://api.assemblyai.com/v2";
const AAI_KEY = process.env.ASSEMBLYAI_API_KEY;

function assertKey() {
    if (!AAI_KEY) {
        throw new Error("Falta ASSEMBLYAI_API_KEY en variables de entorno.");
    }
}

/**
 * Sube un archivo local (MP3/MP4) y devuelve un upload_url temporal de AssemblyAI.
 * @param {string} filePath - ruta al archivo local.
 * @returns {Promise<string>} upload_url
 */
async function uploadLocalFile(filePath) {
    assertKey();
    if (!fs.existsSync(filePath)) {
        throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    const stream = fs.createReadStream(filePath);

    const resp = await fetch(`${AAI_BASE}/upload`, {
        method: "POST",
        headers: {
            authorization: AAI_KEY,
            "Content-Type": "application/octet-stream"
        },
        body: stream,           // ← COMA necesaria
        duplex: "half"          // ← requerido por Node 18+/20+/22+ con streams
    });


    if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Fallo upload: ${resp.status} ${t}`);
    }

    const data = await resp.json();
    return data.upload_url;
}

/**
 * Crea un job de transcripción con resumen del lado de AssemblyAI.
 * @param {string} localAudioPath - ruta local del MP3 (o MP4).
 * @returns {Promise<string>} transcriptId
 */
async function createTranscriptionJob(localAudioPath) {
    assertKey();

    const audioUrl = await uploadLocalFile(localAudioPath);

    const payload = {
        audio_url: audioUrl,
        language_code: "es",
        language_detection: false,
        punctuate: true,
        // summarization: true,
        // summary_model: "informative",
        // summary_type: "paragraph"
    };

    const resp = await fetch(`${AAI_BASE}/transcript`, {
        method: "POST",
        headers: {
            authorization: AAI_KEY,
            "content-type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Fallo create transcript: ${resp.status} ${t}`);
    }

    const data = await resp.json();
    return data.id; // transcriptId
}

/**
 * Espera hasta que el job termine o falle.
 * @param {string} transcriptId
 * @param {{intervalMs?:number,maxMinutes?:number}} options
 * @returns {Promise<object>} transcript data completo (status, text, summary, etc.)
 */
async function waitForCompletion(
    transcriptId,
    { intervalMs = 5000, maxMinutes = 30 } = {}
) {
    assertKey();

    const maxTries = Math.ceil((maxMinutes * 60 * 1000) / intervalMs);

    for (let i = 0; i < maxTries; i++) {
        const resp = await fetch(`${AAI_BASE}/transcript/${transcriptId}`, {
            headers: { authorization: AAI_KEY }
        });

        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`Fallo get transcript: ${resp.status} ${t}`);
        }

        const data = await resp.json();

        if (data.status === "completed") return data;
        if (data.status === "error") {
            throw new Error(`Transcripción con error: ${data.error}`);
        }

        await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error("Timeout esperando transcripción.");
}

/**
 * Obtiene { text, summary } del transcript.
 * @param {string} transcriptId
 * @returns {Promise<{text:string, summary:string}>}
 */
async function getTranscriptText(transcriptId) {
    assertKey();

    const resp = await fetch(`${AAI_BASE}/transcript/${transcriptId}`, {
        headers: { authorization: AAI_KEY }
    });

    if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Fallo get transcript text: ${resp.status} ${t}`);
    }

    const data = await resp.json();
    return {
        text: data.text || "",
        summary: data.summary || ""
    };
}

/**
 * Placeholder por si luego quieres un resumen alternativo (LeMUR).
 * Por ahora retorna null para indicar que se use `summary` del transcript.
 */
async function summarizeWithLeMUR(_text) {
    return null;
}

module.exports = {
    uploadLocalFile,
    createTranscriptionJob,
    waitForCompletion,
    getTranscriptText,
    summarizeWithLeMUR
};
