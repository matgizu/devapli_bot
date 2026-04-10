import { askClaude, ClaudeResponse } from "./brain";
import {
  getSession,
  updateSession,
  Session,
  LeadInfo,
} from "./session";
import { calendarClient, CalendarSlot } from "../calendar/client";
import { upsertLead, createMeeting } from "../leads/manager";
import { persistMessage } from "../db/conversations";
import { botEvents } from "../events/emitter";
import { restartRemarketingTimer, cancelFollowUp } from "./remarketing";
import { sendProofImages } from "../whatsapp/sender";
import { PROOF_IMAGES, HUMAN_BEHAVIOR } from "../config";
import { notifyMeetingBooked } from "../notifications/notify";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const FALLBACK_MESSAGE =
  "Hola, gracias por escribirnos. Soy Aria de la agencia — ¿en qué puedo ayudarte hoy?";

export async function processMessage(
  waId: string,
  displayName: string,
  userText: string
): Promise<string[]> {
  const session = getSession(waId, displayName);

  // Detectar si es el primer mensaje de la conversación (antes de agregar el actual)
  const isFirstMessage = session.history.length === 0;

  // Persistir mensaje del usuario
  await persistMessage(waId, "user", userText);
  session.history.push({ role: "user", content: userText });

  // Reiniciar el timer de remarketing — el usuario está activo, postergamos 1h
  restartRemarketingTimer(waId);

  // Emitir evento SSE
  botEvents.emit("event", {
    type: "user_message",
    waId,
    displayName: session.displayName,
    text: userText,
    ts: Date.now(),
  });

  try {
    // Primera llamada a Claude
    let claudeRes = await askClaude(session, userText);

    // ── Acción: CHECK_CALENDAR ──────────────────────────────────────────────
    if (claudeRes.action === "CHECK_CALENDAR") {
      console.log(`[flow] CHECK_CALENDAR para ${waId} — consultando slots...`);
      const slots = await fetchSlots();
      updateSession(waId, { availableSlots: slots });

      // Segunda llamada a Claude con los slots inyectados
      claudeRes = await askClaude(session, userText, slots);
    }

    // ── Actualizar información del lead ────────────────────────────────────
    if (claudeRes.leadUpdate) {
      applyLeadUpdate(session, claudeRes.leadUpdate as Record<string, unknown>);
    }

    // ── Cambio de estado ───────────────────────────────────────────────────
    updateSession(waId, { state: claudeRes.state });

    // ── Lógica de negocio por estado ───────────────────────────────────────
    if (claudeRes.state === "DISQUALIFIED" && session.lead.disqualified !== true) {
      cancelFollowUp(waId);
      updateSession(waId, { lead: { ...session.lead, disqualified: true } });
      await upsertLead(waId, displayName, session.lead);
      botEvents.emit("event", {
        type: "lead_disqualified",
        waId,
        displayName: session.displayName,
        ts: Date.now(),
      });
    }

    if (
      claudeRes.leadUpdate?.qualified === true &&
      session.lead.qualified !== true
    ) {
      await upsertLead(waId, displayName, session.lead);
      botEvents.emit("event", {
        type: "lead_qualified",
        waId,
        displayName: session.displayName,
        ts: Date.now(),
      });
    }

    // ── Acción: BOOK_MEETING ───────────────────────────────────────────────
    if (claudeRes.action === "BOOK_MEETING" && !session.meetingBooked) {
      const bookResult = await bookMeeting(session, waId, displayName);
      if (bookResult.success) {
        updateSession(waId, { meetingBooked: true, state: "CONFIRMED" });
        cancelFollowUp(waId);

        if (session.lead.selectedSlot) {
          await createMeeting({
            waId,
            scheduledAt: new Date(session.lead.selectedSlot),
            slotId: session.lead.slotId,
            calendarEventId: bookResult.calendarEventId,
            attendeeName: session.lead.name,
            attendeeEmail: session.lead.email,
            attendeePhone: waId,
          });

          botEvents.emit("event", {
            type: "meeting_booked",
            waId,
            displayName: session.displayName,
            scheduledAt: session.lead.selectedSlot,
            ts: Date.now(),
          });

          // ── Notificación WhatsApp interna ────────────────────────────────
          await notifyMeetingBooked({
            name: session.lead.name ?? session.displayName,
            waId,
            email: session.lead.email ?? "",
            businessName: session.lead.businessName ?? "",
            scheduledAt: session.lead.selectedSlot,
          });
        }
      } else {
        console.error("[flow] Error al reservar reunión:", bookResult.error);
        // No interrumpir — Claude ya generó un mensaje de confirmación.
        // El error se loguea y se puede revisar en Railway.
      }
    }

    // ── Persistir respuesta y actualizar lead en DB ────────────────────────
    await persistMessage(waId, "assistant", claudeRes.message);
    session.history.push({ role: "assistant", content: claudeRes.message });
    await upsertLead(waId, displayName, session.lead);

    // ── Emitir respuesta del bot ───────────────────────────────────────────
    botEvents.emit("event", {
      type: "bot_reply",
      waId,
      text: claudeRes.message,
      ts: Date.now(),
    });

    // ── Delay humano en primer mensaje (10s) ──────────────────────────────
    if (isFirstMessage) {
      await sleep(HUMAN_BEHAVIOR.firstMessageDelayMs);
    }

    // ── Imágenes de prueba justo después del saludo ────────────────────────
    if (isFirstMessage && PROOF_IMAGES.length > 0) {
      setTimeout(() => {
        sendProofImages(waId).catch((err) =>
          console.error("[flow] Error enviando imágenes de prueba:", err)
        );
      }, 3000);
    }

    return [claudeRes.message];
  } catch (error) {
    console.error("[flow] Error procesando mensaje:", error);
    return [FALLBACK_MESSAGE];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchSlots(): Promise<CalendarSlot[]> {
  try {
    return await calendarClient.getAvailableSlots();
  } catch (error) {
    console.error("[flow] Error obteniendo slots del calendario:", error);
    return [];
  }
}

async function bookMeeting(
  session: Session,
  waId: string,
  displayName: string
): Promise<{ success: boolean; calendarEventId?: string; error?: string }> {
  if (!session.lead.selectedSlot) {
    return { success: false, error: "No hay slot seleccionado" };
  }
  if (!session.lead.email) {
    return { success: false, error: "No hay email del prospecto" };
  }

  return calendarClient.bookSlot({
    slotTime: session.lead.selectedSlot,
    slotId: session.lead.slotId,
    attendeeName: session.lead.name ?? displayName,
    attendeeEmail: session.lead.email,
    attendeePhone: waId,
  });
}

function applyLeadUpdate(session: Session, update: Record<string, unknown>): void {
  const lead = session.lead;

  if (update.name) lead.name = update.name as string;
  if (update.email) lead.email = update.email as string;
  if (update.businessName) lead.businessName = update.businessName as string;
  if (update.businessType) lead.businessType = update.businessType as string;
  if (update.monthlyBudget) lead.monthlyBudget = update.monthlyBudget as string;
  if (update.budgetAmount != null) lead.budgetAmount = Number(update.budgetAmount) || 0;
  if (update.businessAge) lead.businessAge = update.businessAge as string;
  if (update.businessAgeMonths != null) lead.businessAgeMonths = Number(update.businessAgeMonths) || 0;
  if (update.qualified !== undefined && update.qualified !== null) lead.qualified = update.qualified as boolean;
  if (update.disqualified !== undefined) lead.disqualified = update.disqualified as boolean;
  if (update.selectedSlot) lead.selectedSlot = update.selectedSlot as string;
  if (update.slotId) lead.slotId = update.slotId as string;

  updateSession(session.waId, { lead });
}
