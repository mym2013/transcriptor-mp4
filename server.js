// server.js
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middlewares
app.use(cors({ origin: "http://localhost:3000" })); // Permite solicitudes desde tu frontend local
app.use(express.json()); // Permite leer JSON en POST

// ✅ Endpoint raíz para pruebas
app.get("/", (req, res) => {
  res.send("Servidor funcionando correctamente desde Railway.");
});

// ✅ Health check (útil para saber si el backend está vivo)
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "backend", port: PORT });
});

// ✅ Endpoint temporal de transcripción (stub)
// ⚠️ Luego aquí se conectará la lógica real con yt-dlp, Whisper, etc.
app.post("/transcribir", (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ ok: false, error: "Falta la URL del video." });
  }

  res.status(200).json({
    ok: true,
    message: "Conexión correcta con el backend ✅",
    videoUrl: url,
  });
});

// ✅ Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
