import { sendText } from "../whatsapp/sender";

async function sendWithRetry(to: string, msg: string, context: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sendText(to, msg);
      return;
    } catch (error) {
      if (attempt < maxRetries) {
        const delayMs = attempt * 3000; // 3s, 6s
        console.warn(`[notify] Error en ${context} (intento ${attempt}/${maxRetries}), reintentando en ${delayMs}ms…`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        console.error(`[notify] Error enviando ${context} tras ${maxRetries} intentos:`, error);
      }
    }
  }
}

export async function notifyMeetingBooked(params: {
  name: string;
  waId: string;
  email: string;
  businessName: string;
  scheduledAt: string;
  monthlyBudget?: string;
}): Promise<void> {
  const notifyNumber = process.env.NOTIFY_WHATSAPP_NUMBER;
  if (!notifyNumber) return;

  const fecha = new Date(params.scheduledAt).toLocaleString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Bogota",
  });

  const msg =
    `📅 *Nueva reunión agendada*\n\n` +
    `👤 ${params.name}\n` +
    `📱 +${params.waId}\n` +
    `✉️ ${params.email || "—"}\n` +
    `🏢 ${params.businessName || "—"}\n` +
    `💰 Presupuesto pauta: ${params.monthlyBudget || "—"}\n` +
    `📆 ${fecha} (hora Colombia)`;

  await sendWithRetry(notifyNumber, msg, "notifyMeetingBooked");
}

export async function notifyHumanTakeover(params: {
  name: string;
  waId: string;
  businessName: string;
}): Promise<void> {
  const notifyNumber = process.env.NOTIFY_WHATSAPP_NUMBER;
  if (!notifyNumber) return;

  const msg =
    `⚠️ *Intervención humana requerida*\n\n` +
    `El cliente sospecha que está hablando con una IA.\n\n` +
    `👤 ${params.name || "Sin nombre"}\n` +
    `📱 +${params.waId}\n` +
    `🏢 ${params.businessName || "—"}\n\n` +
    `El bot está pausado. Entrá a la conversación manualmente.`;

  await sendWithRetry(notifyNumber, msg, "notifyHumanTakeover");
}
