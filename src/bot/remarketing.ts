import Anthropic from "@anthropic-ai/sdk";
import { REMARKETING, AGENCY, PERFORMANCE_IA, CLAUDE as CLAUDE_CONFIG } from "../config";
import {
  getExistingSession,
  getSession,
  clearRemarketingTimer,
  updateSession,
  ConversationState,
} from "./session";
import { sendWithHumanDelay } from "../whatsapp/sender";
import { getConversationHistory } from "../db/conversations";
import { prisma } from "../db/prisma";

const claudeClient = new Anthropic({ apiKey: CLAUDE_CONFIG.apiKey });

// ─── Prompt de sistema para remarketing ──────────────────────────────────────

function buildRemarketingPrompt(
  state: ConversationState,
  lead: { name?: string; businessName?: string }
): string {
  return `Sos ${AGENCY.botName}, la asistente de ventas de ${AGENCY.name}, una agencia de marketing digital especializada en IA.

La conversación de WhatsApp con este prospecto se interrumpió — dejó de responder. Tu tarea es generar UN SOLO mensaje de seguimiento para retomar la conversación de forma natural.

CONTEXTO:
- Nombre: ${lead.name || "desconocido"}
- Negocio: ${lead.businessName || "desconocido"}
- Estado en el flujo: ${state}

REGLAS ESTRICTAS:
- Máximo 50 palabras
- Tono cálido y directo, sin presión ni desesperación
- Retomá exactamente donde quedó la conversación — no empieces de cero ni saludes como si fuera la primera vez
- No repitas preguntas que ya se respondieron en el historial
- Respondé SOLO con el texto del mensaje, sin JSON, sin comillas, sin explicaciones adicionales
- Máximo 1 emoji
- Escribí como una persona real por WhatsApp`;
}

// ─── Generar mensaje con Claude usando historial real de DB ───────────────────

async function generateRemarketingMessage(
  waId: string,
  state: ConversationState,
  lead: { name?: string; businessName?: string }
): Promise<string> {
  let dbHistory: { role: "user" | "assistant"; content: string }[] = [];

  try {
    const raw = await getConversationHistory(waId, 20);
    dbHistory = raw.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
  } catch (err) {
    console.error("[remarketing] Error cargando historial:", err);
  }

  if (!dbHistory.length) {
    return getFallbackMessage(state, lead.name ?? "", lead.businessName ?? "");
  }

  // Construir array de mensajes garantizando que termina en "user"
  const messages: Anthropic.MessageParam[] = [...dbHistory];
  const systemNote =
    "[SISTEMA: El usuario lleva más de 1 hora sin responder. Generá un mensaje de seguimiento para retomar la conversación.]";

  const last = messages[messages.length - 1];
  if (last.role === "user") {
    // Agregar nota al último mensaje del usuario
    messages[messages.length - 1] = {
      ...last,
      content:
        typeof last.content === "string"
          ? last.content + "\n\n" + systemNote
          : systemNote,
    };
  } else {
    messages.push({ role: "user", content: systemNote });
  }

  try {
    const response = await claudeClient.messages.create({
      model: CLAUDE_CONFIG.model,
      max_tokens: 200,
      temperature: 0.4,
      system: buildRemarketingPrompt(state, lead),
      messages,
    });

    const text = response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as Anthropic.TextBlock).text)
      .join("")
      .trim();

    return text || getFallbackMessage(state, lead.name ?? "", lead.businessName ?? "");
  } catch (error) {
    console.error("[remarketing] Error llamando a Claude:", error);
    return getFallbackMessage(state, lead.name ?? "", lead.businessName ?? "");
  }
}

// ─── Mensajes de fallback cuando no hay historial ────────────────────────────

function getFallbackMessage(state: string, name: string, businessName: string): string {
  const n = name ? `, ${name}` : "";
  const b = businessName ? ` para ${businessName}` : "";

  const map: Record<string, string[]> = {
    GREETING: [
      `Hola${n} 👋 ¿Pudiste ver la información sobre la garantía por contrato? ¿Alguna pregunta?`,
      `${name || "Hola"}, ¿tuviste chance de revisar lo que te enviamos? Estoy aquí si querés saber más.`,
    ],
    QUALIFYING: [
      `Hola${n} 👋 Quedamos a medias. Solo necesito un par de datos más para saber si podemos ayudarte${b}. ¿Continuamos?`,
      `${name || "Hola"}, ¿surgió alguna duda que frenó la conversación? Estoy aquí para responderte.`,
    ],
    SCHEDULING: [
      `Hola${n} 👋 Quedaste muy cerca de agendar tu sesión${b}. ¿Cuál horario te quedó mejor?`,
      `${name || "Hola"}, la sesión es 30 min sin costo ni compromiso. ¿La agendamos? 🗓️`,
    ],
  };

  const variants = map[state] ?? map.GREETING;
  return variants[Math.floor(Math.random() * variants.length)];
}

// ─── Lógica principal ─────────────────────────────────────────────────────────

function shouldContinue(waId: string): boolean {
  const session = getExistingSession(waId);
  return (
    !!session &&
    !session.meetingBooked &&
    !session.paused &&
    session.state !== "DISQUALIFIED" &&
    session.state !== "CONFIRMED" &&
    session.remarketingCount < REMARKETING.maxAttempts
  );
}

async function runFollowUp(waId: string): Promise<void> {
  const session = getExistingSession(waId);
  if (!session || !shouldContinue(waId)) return;

  const { name, businessName } = session.lead;
  const count = session.remarketingCount;
  const state = session.state as ConversationState;

  try {
    const message = await generateRemarketingMessage(waId, state, { name, businessName });
    await sendWithHumanDelay(waId, message);
    console.log(`[remarketing] Follow-up #${count + 1} enviado a ${waId} (estado: ${state})`);
    updateSession(waId, { remarketingCount: count + 1 });
  } catch (error) {
    console.error(`[remarketing] Error enviando follow-up a ${waId}:`, error);
  }

  if (shouldContinue(waId)) {
    scheduleNext(waId, REMARKETING.intervalMs);
  }
}

function scheduleNext(waId: string, delayMs: number): void {
  clearRemarketingTimer(waId);

  const timer = setTimeout(() => {
    runFollowUp(waId).catch((err) =>
      console.error(`[remarketing] Error en runFollowUp para ${waId}:`, err)
    );
  }, delayMs);

  updateSession(waId, { remarketingTimer: timer });
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function restartRemarketingTimer(waId: string): void {
  const session = getExistingSession(waId);
  if (
    !session ||
    session.meetingBooked ||
    session.paused ||
    session.state === "DISQUALIFIED" ||
    session.state === "CONFIRMED"
  ) {
    return;
  }

  scheduleNext(waId, REMARKETING.firstDelayMs);
}

export function cancelFollowUp(waId: string): void {
  clearRemarketingTimer(waId);
  console.log(`[remarketing] Ciclo cancelado para ${waId}`);
}

/**
 * Restaura timers de remarketing desde la DB al iniciar el servidor.
 * Evita que reinicios de Railway pierdan el estado de todos los contactos.
 */
export async function initRemarketingFromDB(): Promise<void> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Conversaciones activas en las últimas 24h
    const conversations = await prisma.conversation.findMany({
      where: { updatedAt: { gte: since } },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const waIds = conversations.map((c) => c.waId);

    // Solo leads que no están descalificados y no tienen reunión agendada
    const leads = await prisma.lead.findMany({
      where: {
        waId: { in: waIds },
        disqualified: false,
        meetings: { none: {} },
      },
      select: {
        waId: true,
        name: true,
        displayName: true,
        businessName: true,
        qualified: true,
      },
    });

    const leadMap = new Map(leads.map((l) => [l.waId, l]));

    let count = 0;
    for (const conv of conversations) {
      const lead = leadMap.get(conv.waId);
      if (!lead) continue; // descalificado o con reunión

      const lastMsgAt = conv.messages[0]?.createdAt ?? conv.updatedAt;
      const timeSince = Date.now() - new Date(lastMsgAt).getTime();

      // Ignorar si ya pasaron más de 24h sin actividad
      if (timeSince > 24 * 60 * 60 * 1000) continue;

      // Reconstruir sesión mínima en memoria
      const derivedState: ConversationState =
        lead.qualified === true ? "SCHEDULING" : "QUALIFYING";

      const session = getSession(conv.waId, lead.name ?? lead.displayName ?? conv.waId);
      updateSession(conv.waId, {
        state: derivedState,
        lead: {
          phone: conv.waId,
          name: lead.name ?? undefined,
          businessName: lead.businessName ?? undefined,
          qualified: lead.qualified,
        },
      });

      // Calcular delay: si ya pasó 1h desde el último mensaje, enviar pronto (30s buffer)
      const delay = Math.max(30_000, REMARKETING.firstDelayMs - timeSince);
      scheduleNext(conv.waId, delay);
      count++;
    }

    console.log(`[remarketing] ${count} timer(s) restaurados desde DB al arrancar`);
  } catch (error) {
    console.error("[remarketing] Error en initRemarketingFromDB:", error);
  }
}
