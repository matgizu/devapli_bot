import { sendText } from "../whatsapp/sender";

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

  try {
    await sendText(notifyNumber, msg);
  } catch (error) {
    console.error("[notify] Error enviando notificación WhatsApp:", error);
  }
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

  try {
    await sendText(notifyNumber, msg);
  } catch (error) {
    console.error("[notify] Error enviando notificación de takeover:", error);
  }
}
