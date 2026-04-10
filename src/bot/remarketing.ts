import { REMARKETING, AGENCY, PERFORMANCE_IA } from "../config";
import { getSession, clearRemarketingTimer, updateSession, ConversationState } from "./session";
import { sendWithHumanDelay } from "../whatsapp/sender";

// ─── Mensajes por estado (rotan para no repetirse) ───────────────────────────

const MESSAGES: Record<string, (name: string, count: number, extra: string) => string> = {

  GREETING: (name, count) => {
    const n = name ? `, ${name}` : "";
    const variants = [
      `Hola${n} 👋 Veo que viste nuestro anuncio pero quedaste con dudas. ¿Tenés alguna pregunta sobre cómo funciona ${PERFORMANCE_IA.systemName} o sobre la garantía por contrato?`,
      `${name || "Hola"}, ¿pudiste leer la información que te envié? La garantía que ofrecemos es algo que ninguna otra agencia da — resultados por contrato o el siguiente mes es gratis. ¿Querés saber más?`,
      `${name || "Hola"} 👋 Entiendo que estás ocupado/a. Solo te recuerdo que tenemos cupos limitados para nuevos clientes este mes. ¿Te cuento cómo podría funcionar para tu negocio?`,
    ];
    return variants[Math.min(count, variants.length - 1)];
  },

  QUALIFYING: (name, count, businessName) => {
    const n = name ? `, ${name}` : "";
    const b = businessName ? ` para ${businessName}` : "";
    const variants = [
      `Hola${n} 👋 Quedamos a medias. Solo necesito un par de datos más para saber si podemos garantizarte resultados${b}. ¿Hace cuánto tiempo tenés el negocio y cuánto invertís actualmente en pauta?`,
      `${name || "Hola"}, ¿tuviste alguna duda sobre el sistema o la garantía que frenó la conversación? Estoy aquí para responderte lo que sea.`,
      `${name || "Hola"} 👋 Te lo digo directo: si tu negocio califica, podemos garantizarte por contrato un retorno mínimo sobre tu inversión en pauta. Solo necesito dos datos para confirmarlo. ¿Hablamos?`,
      `${name || "Hola"}, entiendo que el día a día no da tregua. Pero invertir 2 minutos ahora puede ahorrarte meses de resultados malos con otra agencia. ¿Continuamos?`,
    ];
    return variants[Math.min(count, variants.length - 1)];
  },

  SCHEDULING: (name, count, businessName) => {
    const n = name ? `, ${name}` : "";
    const b = businessName ? ` para ${businessName}` : "";
    const variants = [
      `Hola${n} 👋 Quedaste muy cerca de agendar tu sesión estratégica${b}. ¿Cuál de los horarios disponibles te quedó mejor?`,
      `${name || "Hola"}, la sesión es 100% sin costo y sin compromiso — son 30 minutos donde te mostramos exactamente cómo ${PERFORMANCE_IA.systemName} escalaría tu negocio. ¿La agendamos?`,
      `${name || "Hola"} 👋 Solo un recordatorio: los cupos para este mes se están llenando. No queremos que te quedes sin tu lugar. ¿Cuándo te queda bien la sesión? 🗓️`,
      `${name || "Hola"}, piénsalo así: si en 30 minutos podés ver si tu negocio puede facturar 3 o 4 veces más con pauta garantizada por contrato, ¿vale la pena? ¿Agendamos?`,
      `${name || "Hola"} 👋 ¿Hubo algo que te frenó para agendar? ¿Un horario que no te convenía, una duda sobre la sesión? Decime y lo resolvemos ahora mismo.`,
    ];
    return variants[Math.min(count, variants.length - 1)];
  },
};

// ─── Lógica principal ─────────────────────────────────────────────────────────

function shouldContinue(waId: string): boolean {
  const session = getSession(waId, "");
  return (
    !!session &&
    !session.meetingBooked &&
    session.state !== "DISQUALIFIED" &&
    session.state !== "CONFIRMED" &&
    session.remarketingCount < REMARKETING.maxAttempts
  );
}

async function runFollowUp(waId: string): Promise<void> {
  const session = getSession(waId, "");
  if (!session || !shouldContinue(waId)) return;

  const { name, businessName } = session.lead;
  const count = session.remarketingCount;
  const state = session.state as ConversationState;

  const messageBuilder = MESSAGES[state] ?? MESSAGES.GREETING;
  const message = messageBuilder(name ?? "", count, businessName ?? "");

  try {
    await sendWithHumanDelay(waId, message);
    console.log(`[remarketing] Follow-up #${count + 1} enviado a ${waId} (estado: ${state})`);
    updateSession(waId, { remarketingCount: count + 1 });
  } catch (error) {
    console.error(`[remarketing] Error enviando follow-up a ${waId}:`, error);
  }

  // Programar el siguiente si aún aplica
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

/**
 * Llama esto cada vez que el usuario manda un mensaje.
 * Reinicia el contador de silencio — el remarketing solo dispara si hay 1h de inactividad.
 */
export function restartRemarketingTimer(waId: string): void {
  const session = getSession(waId, "");
  if (
    !session ||
    session.meetingBooked ||
    session.state === "DISQUALIFIED" ||
    session.state === "CONFIRMED"
  ) {
    return;
  }

  scheduleNext(waId, REMARKETING.firstDelayMs);
}

/**
 * Cancela el remarketing definitivamente (reunión agendada o lead descalificado).
 */
export function cancelFollowUp(waId: string): void {
  clearRemarketingTimer(waId);
  console.log(`[remarketing] Ciclo cancelado para ${waId}`);
}
