// script.js — CAP 11 estable
// Maneja el formulario, conecta con /transcribir y muestra resultados.

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
        const $inFile = document.querySelector("#fileInput");
        const $inUrl = document.querySelector("#urlInput");
        const $txtPromptResumen = document.querySelector("#summaryPrompt");

        const $estado = document.querySelector("#estado");
        const $resultado = document.querySelector("#outLogs");
        const $txtTranscripcion = document.querySelector("#outTranscripcion");
        const $txtResumen = document.querySelector("#outResumen");
        const $btnSubmit = document.querySelector("#btnTranscribir");

        if (!$form) {
            console.error("[CAP11] No se encontró #form-transcribir en el DOM");
            return;
        }

        // ====== Utilidades de UI ======
        function setEstado(msg, tipo = "info") {
            if (!$estado) return;
            $estado.textContent = msg ?? "";
            $estado.classList.remove("ok", "error", "info", "working");
            $estado.classList.add(tipo);
        }

        function habilitarEnvio(enabled) {
            if ($btnSubmit) $btnSubmit.disabled = !enabled;
            if ($inFile) $inFile.disabled = !enabled;
            if ($inUrl) $inUrl.disabled = !enabled;
            if ($txtPromptResumen) $txtPromptResumen.disabled = !enabled;
        }

        function limpiarResultados() {
            if ($resultado) $resultado.innerHTML = "";
            if ($txtTranscripcion) $txtTranscripcion.textContent = "";
            if ($txtResumen) $txtResumen.textContent = "";
        }

        function pintarTexto($el, label, contenido) {
            if (!$el) return;
            const prefix = label ? `${label}:\n` : "";
            $el.textContent = `${prefix}${contenido ?? ""}`;
        }

        function renderKV(obj) {
            const frag = document.createDocumentFragment();
            const pre = document.createElement("pre");
            pre.style.whiteSpace = "pre-wrap";
            pre.textContent = Object.entries(obj)
                .filter(([, v]) => v != null && v !== "")
                .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                .join("\n");
            frag.appendChild(pre);
            return frag;
        }

        const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
        const isLocalFsPath = (s) =>
            typeof s === "string" && (/[A-Za-z]:\\/.test(s) || s.startsWith("/") || s.includes("\\"));

        // ====== Construir FormData ======
        function construirFormData() {
            const fd = new FormData();

            const file = $inFile && $inFile.files && $inFile.files[0] ? $inFile.files[0] : null;
            const url = $inUrl && $inUrl.value ? $inUrl.value.trim() : "";

            if (file) {
                const ext = file.name.split(".").pop().toLowerCase();
                if (!file.type.startsWith("video/") || ext !== "mp4") {
                    throw new Error("Solo se admiten archivos de video MP4 (.mp4).");
                }
                fd.append("video", file, file.name);
            } else if (url) {
                fd.append("url", url);
            } else {
                throw new Error("Debes seleccionar un archivo MP4 o ingresar una URL.");
            }

            fd.append("resumen", "false");
            return fd;
        }

        // ====== fetch con timeout ======
        async function postConTimeout(url, options = {}, ms = 5 * 60 * 1000) {
            const ctrl = new AbortController();
            const id = setTimeout(() => ctrl.abort(), ms);
            try {
                const res = await fetch(url, { ...options, signal: ctrl.signal });
                return res;
            } finally {
                clearTimeout(id);
            }
        }

        // ====== Envío del formulario ======
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
                    const texto = await res.text().catch(() => "");
                    throw new Error(`HTTP ${res.status} ${res.statusText} — ${texto}`);
                }

                const data = await res.json();
                if (data.ok !== true) {
                    const msg = data.error || data.message || "El backend indicó un fallo.";
                    throw new Error(msg);
                }

                // Mostrar logs
                if ($resultado) {
                    const kv = {
                        mp4Path: data.mp4Path,
                        mp3Path: data.mp3Path,
                        transcriptTxtPath: data.transcriptTxtPath,
                        summaryTxtPath: data.summaryTxtPath,
                        mp4Url: data.mp4Url,
                        mp3Url: data.mp3Url,
                        transcriptUrl: data.transcriptUrl,
                        summaryUrl: data.summaryUrl,
                    };
                    const card = document.createElement("div");
                    card.className = "resultado-card";
                    card.appendChild(renderKV(kv));
                    $resultado.appendChild(card);
                }

                // Mostrar transcripción
                if (data.transcriptText && $txtTranscripcion) {
                    pintarTexto($txtTranscripcion, "Transcripción", data.transcriptText);
                } else if ((data.transcriptUrl || data.transcriptTxtPath) && $txtTranscripcion) {
                    const tUrl = data.transcriptUrl || data.transcriptTxtPath;
                    if (isHttpUrl(tUrl)) {
                        try {
                            const r = await fetch(tUrl);
                            if (r.ok) {
                                const text = await r.text();
                                pintarTexto($txtTranscripcion, "Transcripción (desde archivo)", text);
                            } else {
                                pintarTexto($txtTranscripcion, "Transcripción", `Archivo disponible: ${tUrl}`);
                            }
                        } catch {
                            pintarTexto($txtTranscripcion, "Transcripción", `Archivo disponible: ${tUrl}`);
                        }
                    } else if (isLocalFsPath(tUrl)) {
                        pintarTexto($txtTranscripcion, "Transcripción", `Archivo generado en servidor: ${tUrl}`);
                    }
                }

                // Mostrar resumen (si existiera)
                if (data.summaryText && $txtResumen) {
                    pintarTexto($txtResumen, "Resumen", data.summaryText);
                } else if ((data.summaryUrl || data.summaryTxtPath) && $txtResumen) {
                    const sUrl = data.summaryUrl || data.summaryTxtPath;
                    if (isHttpUrl(sUrl)) {
                        try {
                            const r = await fetch(sUrl);
                            if (r.ok) {
                                const text = await r.text();
                                pintarTexto($txtResumen, "Resumen (desde archivo)", text);
                            } else {
                                pintarTexto($txtResumen, "Resumen", `Archivo disponible: ${sUrl}`);
                            }
                        } catch {
                            pintarTexto($txtResumen, "Resumen", `Archivo disponible: ${sUrl}`);
                        }
                    } else if (isLocalFsPath(sUrl)) {
                        pintarTexto($txtResumen, "Resumen", `Archivo generado en servidor: ${sUrl}`);
                    }
                }

                setEstado("Completado.", "ok");
            } catch (err) {
                console.error(err);
                setEstado(err.message || "Error desconocido en el envío.", "error");
            } finally {
                habilitarEnvio(true);
            }
        }

        $form.addEventListener("submit", onSubmit);
        console.log("[CAP11] script.js cargado y listo.");
    }
})();
