document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("form-transcriptor");
    const fileInput = document.getElementById("video");
    const btnEnviar = document.getElementById("btn-enviar");

    const statusEl = document.getElementById("status");
    const transcriptEl = document.getElementById("transcript");
    const summaryEl = document.getElementById("summary");
    const filesListEl = document.getElementById("files-list");

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function limpiarSalida() {
        transcriptEl.value = "";
        summaryEl.value = "";
        filesListEl.innerHTML = "";
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const file = fileInput.files[0];
        if (!file) {
            setStatus("Debes seleccionar un archivo MP4.");
            return;
        }

        const formData = new FormData();
        // Debe coincidir EXACTO con upload.single("video")
        formData.append("video", file);

        limpiarSalida();
        setStatus("Procesando... esto puede tardar, no cierres la página.");
        btnEnviar.disabled = true;

        try {
            const response = await fetch("/transcribir", {
                method: "POST",
                body: formData,
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || !data) {
                setStatus("Error al procesar la solicitud.");
                return;
            }

            if (data.ok === false) {
                setStatus(data.error || data.transcribeError || "Error desconocido.");
                return;
            }

            // Estado
            let texto = "Transcripción completada.";
            if (data.transcribeError) {
                texto += "\n⚠ Advertencia: " + data.transcribeError;
            }
            setStatus(texto);

            // Transcripción + resumen
            transcriptEl.value = data.transcriptText || "";
            summaryEl.value = data.summaryText || "";

            // Links a archivos
            function addLink(nombre, url) {
                if (!url) return;
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = url;
                a.textContent = nombre;
                a.target = "_blank";
                li.appendChild(a);
                filesListEl.appendChild(li);
            }

            addLink("Transcripción (.txt)", data.transcriptUrl);
            addLink("Resumen (.txt)", data.summaryUrl);
            addLink("Audio MP3", data.mp3Url);
            addLink("Video MP4", data.mp4Url);

        } catch (err) {
            setStatus("Error de conexión: " + err.message);
        }

        btnEnviar.disabled = false;
    });
});
