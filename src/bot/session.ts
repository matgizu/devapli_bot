import { CalendarSlot } from "../calendar/client";

export type ConversationState =
  | "GREETING"
  | "QUALIFYING"
  | "DISQUALIFIED"
  | "SCHEDULING"
  | "CONFIRMED";

export interface LeadInfo {
  name?: string;
  phone: string;
  email?: string;
  businessName?: string;
  businessType?: string;
  monthlyBudget?: string;
  budgetAmount?: number;
  businessAge?: string;
  businessAgeMonths?: number;
  qualified?: boolean | null;
  disqualified?: boolean;
  selectedSlot?: string;   // ISO datetime del slot elegido
  slotId?: string;         // ID del slot en el proveedor de calendario
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  waId: string;
  displayName: string;
  state: ConversationState;
  history: SessionMessage[];
  lead: LeadInfo;
  availableSlots?: CalendarSlot[];  // Inyectados cuando Claude dispara CHECK_CALENDAR
  meetingBooked: boolean;
  paused: boolean;  // true cuando se requiere intervención humana (sospecha de IA)
  remarketingTimer?: ReturnType<typeof setTimeout>;
  remarketingCount: number;   // cuántos follow-ups se han enviado
  createdAt: Date;
  updatedAt: Date;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

const sessions = new Map<string, Session>();

export function getSession(waId: string, displayName: string): Session {
  let session = sessions.get(waId);

  if (!session) {
    session = {
      waId,
      displayName,
      state: "GREETING",
      history: [],
      lead: { phone: waId },
      meetingBooked: false,
      paused: false,
      remarketingCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    sessions.set(waId, session);
    console.log(`[session] Nueva sesión creada para ${waId} (${displayName})`);
  } else {
    // Actualizar displayName si ahora lo tenemos
    if (displayName && displayName !== waId) {
      session.displayName = displayName;
    }
    session.updatedAt = new Date();
  }

  return session;
}

export function updateSession(waId: string, updates: Partial<Session>): void {
  const session = sessions.get(waId);
  if (!session) return;
  Object.assign(session, updates, { updatedAt: new Date() });
}

export function getSessionState(waId: string): ConversationState | null {
  return sessions.get(waId)?.state ?? null;
}

export function getExistingSession(waId: string): Session | null {
  return sessions.get(waId) ?? null;
}

export function pushToSessionHistory(
  waId: string,
  role: "user" | "assistant",
  content: string
): void {
  const session = sessions.get(waId);
  if (!session) return;
  session.history.push({ role, content });
  session.updatedAt = new Date();
}

export function clearRemarketingTimer(waId: string): void {
  const session = sessions.get(waId);
  if (session?.remarketingTimer) {
    clearTimeout(session.remarketingTimer);
    session.remarketingTimer = undefined;
  }
}

// Limpieza periódica de sesiones vencidas
setInterval(() => {
  const now = Date.now();
  for (const [waId, session] of sessions.entries()) {
    if (now - session.updatedAt.getTime() > SESSION_TTL_MS) {
      clearRemarketingTimer(waId);
      sessions.delete(waId);
      console.log(`[session] Sesión expirada eliminada: ${waId}`);
    }
  }
}, 60 * 60 * 1000); // Cada hora
