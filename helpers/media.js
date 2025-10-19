// helpers/media.js
// Conversión MP4 → MP3 usando FFmpeg (sistema debe tener ffmpeg en PATH)

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Convierte un archivo MP4 a MP3 en la misma carpeta (uploads) y devuelve la ruta del MP3.
 * @param {string} mp4Path - Ruta absoluta del .mp4 de entrada.
 * @returns {Promise<{ mp3Path: string }>}
 */
function convertirMp4AMp3(mp4Path) {
    return new Promise((resolve, reject) => {
        try {
            if (!fs.existsSync(mp4Path)) {
                return reject(new Error(`No existe el archivo de entrada: ${mp4Path}`));
            }

            const { dir, name } = path.parse(mp4Path);
            const mp3Path = path.join(dir, `${name}.mp3`);

            // Si existe un MP3 previo, lo eliminamos para evitar conflictos
            try { if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path); } catch { }

            // Comando FFmpeg: extraer audio a MP3 (128 kbps por defecto)
            const args = [
                "-y",            // sobrescribir salida
                "-i", mp4Path,   // entrada
                "-vn",           // sin video
                "-acodec", "libmp3lame",
                "-ab", "128k",
                mp3Path
            ];

            const ff = spawn("ffmpeg", args, { windowsHide: true });

            ff.on("error", (err) => reject(new Error(`No se pudo ejecutar ffmpeg: ${err.message}`)));

            let stderr = "";
            ff.stderr.on("data", (d) => { stderr += d.toString(); });

            ff.on("close", (code) => {
                if (code === 0 && fs.existsSync(mp3Path)) {
                    resolve({ mp3Path });
                } else {
                    reject(new Error(`FFmpeg falló (code ${code}). Detalle: ${stderr.slice(0, 500)}`));
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = { convertirMp4AMp3 };
