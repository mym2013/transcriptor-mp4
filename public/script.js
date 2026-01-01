// script.js — CAP12
// Maneja formulario, validación y envío para: audio (mp3/wav/m4a) | video mp4 | url

(() => {
    "use strict";

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    function init() {
        // ====== Selectores ======
        const $form = document.querySelector("#form-transcribir");
        const $inVideo = document.querySelector("#fileInput");
        const $inAudio = document.querySelector("#audioInput");
        const $inUrl = document.querySelector("#urlInput");
        const $txtPromptResumen = document.querySelector("#summaryPrompt");

        const $estado = document.querySelector("#estado");
        const $outLogs = document.querySelector("#outLogs");
        const $outTranscripcion = document.querySelector("#outTranscripcion");
        const $outResumen = document.querySelector("#outResumen");
        const $btnSubmit = document.querySelector("#btnTranscribir");

        if (!$form) {
            console.error("[CAP12] No se encontró #form-transcribir");
            return;
        }

        // ====== UI helpers ======
        function setEstado(msg, tipo = "info") {
            if (!$estado) return;
            $estado.textContent = msg ?? "";
            $estado.className = `feedback ${tipo}`;
        }

        function habilitarEnvio(enabled) {
            [$btnSubmit, $inVideo, $inAudio, $inUrl, $txtPromptResumen]
                .filter(Boolean)
                .forEach((el) => (el.disabled = !enabled));
        }

        function limpiarResultados() {
            if ($outLogs) $outLogs.innerHTML = "";
            if ($outTranscripcion) $outTranscripcion.textContent = "";
            if ($outResumen) $outResumen.textContent = "";
        }

        function renderKV(obj) {
            const pre = document.createElement("pre");
            pre.style.whiteSpace = "pre-wrap";
            pre.textContent = Object.entries(obj)
                .filter(([, v]) => v != null && v !== "")
                .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                .join("\n");
            return pre;
        }

        const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);

        // ====== Validaciones ======
        function validarAudio(file) {
            const ext = file.name.split(".").pop().toLowerCase();
            const okExt = ["mp3", "wav", "m4a"].includes(ext);
            const okMime =
                file.type.startsWith("audio/") ||
                file.type.includes("mpeg") ||
                file.type.includes("wav") ||
                file.type.includes("mp4");
            if (!okExt || !okMime) {
                throw new Error("Audio inválido. Solo MP3 / WAV / M4A.");
            }
        }

        function validarVideo(file) {
            const ext = file.name.split(".").pop().toLowerCase();
            if (ext !== "mp4" || !file.type.startsWith("video/")) {
                throw new Error("Video inválido. Solo MP4.");
            }
        }

        // ====== FormData (CAP12) ======
        function construirFormData() {
            const fd = new FormData();

            const audio = $inAudio?.files?.[0] || null;
            const video = $inVideo?.files?.[0] || null;
            const url = $inUrl?.value?.trim() || "";

            // Prioridad: audio > video > url
            if (audio) {
                validarAudio(audio);
                fd.append("audio", audio, audio.name);
            } else if (video) {
                validarVideo(video);
                fd.append("video", video, video.name);
            } else if (url) {
                if (!isHttpUrl(url)) {
                    throw new Error("La URL no es válida.");
                }
                fd.append("url", url);
            } else {
                throw new Error("Debes subir audio, video MP4 o ingresar una URL.");
            }

            // bandera resumen (por ahora fijo)
            fd.append("resumen", "false");
            return fd;
        }

        // ====== Fetch con timeout ======
        async function postConTimeout(url, options = {}, ms = 5 * 60 * 1000) {
            const ctrl = new AbortController();
            const id = setTimeout(() => ctrl.abort(), ms);
            try {
                return await fetch(url, { ...options, signal: ctrl.signal });
            } finally {
                clearTimeout(id);
            }
        }

        // ====== Submit ======
        async function onSubmit(e) {
            e.preventDefault();
            limpiarResultados();
            setEstado("Procesando…", "working");
            habilitarEnvio(false);

            let fd;
            try {
                fd = construirFormData();
            } catch (err) {
                setEstado(err.message || "Error de validación.", "error");
                habilitarEnvio(true);
                return;
            }

            try {
                const res = await postConTimeout("/transcribir", {
                    method: "POST",
                    headers: { Accept: "application/json" },
                    body: fd,
                });

                if (!res.ok) {
                    const txt = await res.text().catch(() => "");
                    throw new Error(`HTTP ${res.status} ${res.statusText} — ${txt}`);
                }

                const data = await res.json();
                if (data.ok !== true) {
                    throw new Error(data.error || "Fallo en backend.");
                }

                // Logs
                if ($outLogs) {
                    $outLogs.appendChild(
                        renderKV({
                            sourceType: data.sourceType,
                            mp4Url: data.mp4Url,
                            mp3Url: data.mp3Url,
                            transcriptUrl: data.transcriptUrl,
                            summaryUrl: data.summaryUrl,
                        })
                    );
                }

                // Transcripción
                if (data.transcriptText && $outTranscripcion) {
                    $outTranscripcion.textContent = data.transcriptText;
                }

                // Resumen
                if (data.summaryText && $outResumen) {
                    $outResumen.textContent = data.summaryText;
                }

                setEstado("Completado.", "ok");
            } catch (err) {
                console.error(err);
                setEstado(err.message || "Error desconocido.", "error");
            } finally {
                habilitarEnvio(true);
            }
        }

        $form.addEventListener("submit", onSubmit);
        console.log("[CAP12] script.js listo.");
    }
})();
