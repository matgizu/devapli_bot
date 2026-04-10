import { prisma } from "../db/prisma";
import { sendWithHumanDelay } from "../whatsapp/sender";
import { AGENCY } from "../config";

// ─── Helpers de formato ───────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Bogota",
  });
}

// ─── Mensajes de recordatorio ─────────────────────────────────────────────────

function msg24h(name: string, scheduledAt: Date): string {
  const n = name ? `${name}` : "Hola";
  return (
    `${n} 👋 Te recuerdo que *mañana ${formatDate(scheduledAt)} a las ${formatTime(scheduledAt)}* ` +
    `tenés tu sesión estratégica con ${AGENCY.name}.\n\n` +
    `¿Confirmás tu asistencia?\n` +
    `👉 Respondé *SÍ* para confirmar o *NO* para cancelar.`
  );
}

function msg2h(name: string, scheduledAt: Date, meetingUrl?: string | null): string {
  const n = name ? `${name}` : "Hola";
  const link = meetingUrl ? `\n\n🔗 Link de la videollamada: ${meetingUrl}` : "";
  return (
    `${n} ⏰ En *2 horas* es tu sesión estratégica con ${AGENCY.name} ` +
    `— *${formatTime(scheduledAt)}*.\n\n` +
    `¡Nos vemos pronto! 🚀${link}`
  );
}

function msgConfirmedYes(name: string): string {
  return `Perfecto ${name || ""} ✅ Quedamos confirmados. Nos vemos mañana, preparate para ver cómo podemos escalar tu negocio.`;
}

function msgConfirmedNo(name: string): string {
  return (
    `Entendido ${name || ""}, cancelamos la reunión sin problema. ` +
    `Si en otro momento querés agendar, acá estamos. ¡Mucho éxito! 🙌`
  );
}

// ─── Lógica principal ─────────────────────────────────────────────────────────

async function checkAndSendReminders(): Promise<void> {
  const now = new Date();

  // ── Recordatorio 24h ────────────────────────────────────────────────────────
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const due24h = await prisma.meeting.findMany({
    where: {
      scheduledAt: { gte: in23h, lte: in25h },
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      reminder24hSentAt: null,
    },
    include: { lead: true },
  });

  for (const meeting of due24h) {
    try {
      const message = msg24h(meeting.lead.name ?? meeting.lead.displayName ?? "", meeting.scheduledAt);
      await sendWithHumanDelay(meeting.waId, message);
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { reminder24hSentAt: new Date() },
      });
      console.log(`[reminders] ✅ Recordatorio 24h enviado a ${meeting.waId}`);
    } catch (err) {
      console.error(`[reminders] Error enviando 24h a ${meeting.waId}:`, err);
    }
  }

  // ── Recordatorio 2h ─────────────────────────────────────────────────────────
  const in1h50 = new Date(now.getTime() + (2 * 60 - 10) * 60 * 1000);
  const in2h10 = new Date(now.getTime() + (2 * 60 + 10) * 60 * 1000);

  const due2h = await prisma.meeting.findMany({
    where: {
      scheduledAt: { gte: in1h50, lte: in2h10 },
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      reminder2hSentAt: null,
    },
    include: { lead: true },
  });

  for (const meeting of due2h) {
    // Solo enviar 2h si el lead no respondió NO al recordatorio 24h
    if (meeting.confirmationResponse === "NO") continue;

    try {
      const message = msg2h(
        meeting.lead.name ?? meeting.lead.displayName ?? "",
        meeting.scheduledAt,
        meeting.meetingUrl
      );
      await sendWithHumanDelay(meeting.waId, message);
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { reminder2hSentAt: new Date() },
      });
      console.log(`[reminders] ✅ Recordatorio 2h enviado a ${meeting.waId}`);
    } catch (err) {
      console.error(`[reminders] Error enviando 2h a ${meeting.waId}:`, err);
    }
  }
}

// ─── Manejo de respuesta de confirmación ─────────────────────────────────────

export async function handleConfirmationReply(
  waId: string,
  text: string
): Promise<string | null> {
  // Buscar si tiene reunión pendiente de confirmación
  const meeting = await prisma.meeting.findFirst({
    where: {
      waId,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      reminder24hSentAt: { not: null },
      confirmationResponse: null,
      scheduledAt: { gte: new Date() },
    },
    include: { lead: true },
    orderBy: { scheduledAt: "asc" },
  });

  if (!meeting) return null;

  const normalized = text.toLowerCase().trim();
  const isYes = /^(s[íi]|si|yes|confirmo|confirmado|claro|perfecto|dale|listo|va|ok)/.test(normalized);
  const isNo = /^(no|cancel|no puedo|no voy|no podré|imposible|nop)/.test(normalized);

  if (!isYes && !isNo) return null;

  const name = meeting.lead.name ?? meeting.lead.displayName ?? "";

  if (isYes) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        confirmationResponse: "YES",
        confirmedAt: new Date(),
        status: "CONFIRMED",
      },
    });
    console.log(`[reminders] ✅ Confirmación YES de ${waId}`);
    return msgConfirmedYes(name);
  } else {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        confirmationResponse: "NO",
        status: "CANCELLED",
        cancelReason: "Cliente canceló por WhatsApp",
      },
    });
    console.log(`[reminders] ❌ Confirmación NO de ${waId}`);
    return msgConfirmedNo(name);
  }
}

// ─── Iniciar el scheduler ─────────────────────────────────────────────────────

export function startReminderScheduler(): void {
  const INTERVAL_MS = 5 * 60 * 1000; // cada 5 minutos

  console.log("[reminders] Scheduler iniciado — revisando cada 5 minutos");

  // Ejecutar inmediatamente al arrancar
  checkAndSendReminders().catch(console.error);

  setInterval(() => {
    checkAndSendReminders().catch(console.error);
  }, INTERVAL_MS);
}
