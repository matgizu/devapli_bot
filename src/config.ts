import dotenv from "dotenv";
dotenv.config();

// ─── Agencia ──────────────────────────────────────────────────────────────────
export const AGENCY = {
  name: process.env.AGENCY_NAME || "Tu Agencia",
  botName: process.env.AGENCY_BOT_NAME || "Aria",
  ownerName: process.env.OWNER_NAME || "el equipo",
  specialization: "Marketing Digital con Inteligencia Artificial",
  meetingTitle: "Sesión Estratégica de Marketing Digital",
  meetingDescription:
    "Diagnóstico de 30 minutos para evaluar oportunidades de crecimiento con pauta e IA.",
};

// ─── Criterios de calificación ────────────────────────────────────────────────
export const QUALIFICATION = {
  // Inversión mensual mínima en pauta (USD)
  MIN_MONTHLY_BUDGET_USD: 400,
  // Zona gris: entre este valor y el mínimo, Claude evalúa con criterio
  // Por debajo de este valor: descalificar siempre
  BORDERLINE_BUDGET_USD: 250,
  // Antigüedad mínima del negocio en meses
  MIN_BUSINESS_AGE_MONTHS: 6,
};

// ─── Calendario (Google Calendar) ────────────────────────────────────────────
export const CALENDAR = {
  provider: "google" as "google" | "custom",
  google: {
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL || "",
    // La private key viene con \n literales desde las variables de entorno
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  },
  custom: {
    baseUrl: process.env.CALENDAR_API_URL || "",
    apiKey: process.env.CALENDAR_API_KEY || "",
  },
  timezone: process.env.TZ || "America/Bogota",
  // Horario de atención (hora local Bogotá)
  workingHours: { start: 9, end: 18 },   // 9am – 6pm
  // Duración de cada reunión en minutos
  meetingDurationMin: 30,
  daysAhead: 7,
  maxSlotsToShow: 5,
};

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
export const WHATSAPP = {
  token: process.env.WHATSAPP_TOKEN || "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  appSecret: process.env.META_APP_SECRET || "",
  verifyToken: process.env.META_VERIFY_TOKEN || "",
};

// ─── Claude ───────────────────────────────────────────────────────────────────
export const CLAUDE = {
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  model: "claude-haiku-4-5-20251001",
  maxTokens: 900,        // suficiente para JSON + slots + mensaje
  maxHistoryTurns: 16,
};

// ─── Comportamiento humano ────────────────────────────────────────────────────
export const HUMAN_BEHAVIOR = {
  debounceMs: 1200,
  // Thinking delay: simula que está leyendo y escribiendo (proporcional al largo de la respuesta)
  // Fórmula objetivo: 5 palabras → ~10s | 35 palabras → ~1 min
  thinkingBaseMs: 2_000,       // base 2s
  thinkingPerWordMs: 1_600,    // 1.6s por palabra → 35 palabras ≈ 58s total
  thinkingMaxMs: 90_000,       // tope 90s
  // Typing delay: tiempo que muestra "escribiendo..." antes de enviar
  typingBaseMs: 1_500,
  typingPerWordMs: 60,
  typingMaxMs: 8_000,
  firstMessageDelayMs: 10_000,  // 10s extra en el primer mensaje
};

// ─── Remarketing ─────────────────────────────────────────────────────────────
export const REMARKETING = {
  // Tiempo de silencio antes del primer follow-up
  firstDelayMs: 60 * 60 * 1000,   // 1 hora
  // Intervalo entre follow-ups subsiguientes
  intervalMs: 60 * 60 * 1000,     // 1 hora
  // Máximo de intentos (8h de remarketing total)
  maxAttempts: 8,
};

// ─── PERFORMANCE IA — sistema y garantías ────────────────────────────────────
export const PERFORMANCE_IA = {
  systemName: "PERFORMANCE IA",
  pillars: [
    "Sistema 90% basado en Inteligencia Artificial — trabaja 24/7 sin parar",
    "Creación masiva de anuncios para encontrar los que convierten en el menor tiempo posible",
    "Chatbots con IA que responden el 100% de los mensajes y toman pedidos automáticamente",
    "Optimización continua en tiempo real sin intervención humana constante",
  ],
  guarantee: {
    month1: "100% de lo invertido en pauta ese mes",
    month2: "entre 2 y 3 veces lo invertido en pauta",
    month3plus: "entre 3 y 4 veces lo invertido en pauta",
    penalty: "trabajamos el mes siguiente COMPLETAMENTE GRATIS",
    contractNote: "todo respaldado por contrato — no son palabras, son compromisos legales",
  },
  differentiator:
    "Ninguna agencia convencional ni un solo humano puede crear, testear y optimizar " +
    "tantos anuncios en tan poco tiempo. La IA lo hace a escala.",
};

// ─── Imágenes de resultados (prueba social) ───────────────────────────────────
// Subí las imágenes a un hosting público (Cloudinary, S3, Imgur, etc.)
// y pegá las URLs aquí o en el .env
export const PROOF_IMAGES: Array<{ url: string; caption: string }> = [
  {
    url: process.env.PROOF_IMAGE_1_URL || "",
    caption: process.env.PROOF_IMAGE_1_CAPTION || "Resultados reales de uno de nuestros clientes 📈",
  },
  {
    url: process.env.PROOF_IMAGE_2_URL || "",
    caption: process.env.PROOF_IMAGE_2_CAPTION || "Otro caso de éxito con PERFORMANCE IA 🚀",
  },
  {
    url: process.env.PROOF_IMAGE_3_URL || "",
    caption: process.env.PROOF_IMAGE_3_CAPTION || "",
  },
].filter((img) => img.url.length > 0); // Solo las que tengan URL configurada
