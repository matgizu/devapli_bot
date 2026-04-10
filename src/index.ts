import "dotenv/config";
import express from "express";
import cors from "cors";
import { webhookRouter } from "./webhooks/whatsapp";
import { apiRouter } from "./api/conversations";
import { startReminderScheduler } from "./reminders/scheduler";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

// Raw body para verificación HMAC
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

// ─── Rutas ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use("/webhook/whatsapp", webhookRouter);
app.use("/api", apiRouter);

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
startReminderScheduler();

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║       BOT AGENCIA — Servidor iniciado            ║
  ║   Puerto: ${PORT}                                     ║
  ║   Webhook: /webhook/whatsapp                     ║
  ║   API:     /api                                  ║
  ║   Health:  /health                               ║
  ╚══════════════════════════════════════════════════╝
  `);
});

export default app;
