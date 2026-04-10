import { sendText } from "../whatsapp/sender";

export async function notifyMeetingBooked(params: {
  name: string;
  waId: string;
  email: string;
  businessName: string;
  scheduledAt: string;
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
    `📆 ${fecha} (hora Colombia)`;

  try {
    await sendText(notifyNumber, msg);
  } catch (error) {
    console.error("[notify] Error enviando notificación WhatsApp:", error);
  }
}
