import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE } from "../config";
import { buildSystemPrompt } from "./prompts";
import { Session, ConversationState } from "./session";
import { CalendarSlot } from "../calendar/client";

const client = new Anthropic({ apiKey: CLAUDE.apiKey });

export interface LeadUpdate {
  name?: string;
  businessName?: string;
  businessType?: string;
  monthlyBudget?: string;
  budgetAmount?: number;
  businessAge?: string;
  businessAgeMonths?: number;
  email?: string;
  qualified?: boolean | null;
  disqualified?: boolean;
  selectedSlot?: string;
  slotId?: string;
}

export interface ClaudeResponse {
  message: string;
  state: ConversationState;
  leadUpdate?: LeadUpdate;
  action?: "CHECK_CALENDAR" | "BOOK_MEETING" | null;
}

export async function askClaude(
  session: Session,
  userMessage: string,
  injectedSlots?: CalendarSlot[]
): Promise<ClaudeResponse> {
  // Construir system prompt con contexto actual y slots si están disponibles
  const systemPrompt = buildSystemPrompt(
    session.lead,
    injectedSlots ?? session.availableSlots
  );

  // Preparar historial (últimos N turnos)
  const recentHistory = session.history.slice(-CLAUDE.maxHistoryTurns);

  // Agregar mensaje actual al historial temporal para el contexto
  const messages: Anthropic.MessageParam[] = [
    ...recentHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  try {
    const response = await client.messages.create({
      model: CLAUDE.model,
      max_tokens: CLAUDE.maxTokens,
      system: systemPrompt,
      messages,
    });

    const rawText = response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as Anthropic.TextBlock).text)
      .join("");

    return parseClaudeResponse(rawText);
  } catch (error) {
    console.error("[brain] Error llamando a Claude:", error);
    throw error;
  }
}

function parseClaudeResponse(raw: string): ClaudeResponse {
  // Extraer JSON de la respuesta (puede venir envuelto en markdown)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Claude respondió en texto plano — usarlo como mensaje directamente
    // en lugar de mostrar el error genérico al usuario
    const cleanText = raw.trim();
    console.warn("[brain] Claude respondió en texto plano (sin JSON):", cleanText.slice(0, 150));
    if (cleanText.length > 0) {
      return {
        message: cleanText,
        state: "SCHEDULING",  // mantener el estado actual — no hacer regresión
        action: null,
      };
    }
    console.error("[brain] Respuesta vacía de Claude");
    return {
      message: "Disculpá, tuve un inconveniente. ¿Podés repetir?",
      state: "SCHEDULING",
      action: null,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ClaudeResponse;

    // Validaciones básicas
    if (!parsed.message || typeof parsed.message !== "string") {
      throw new Error("Campo 'message' inválido");
    }
    if (!parsed.state) {
      throw new Error("Campo 'state' inválido");
    }

    return parsed;
  } catch (error) {
    console.error("[brain] Error parseando JSON de Claude:", error, raw.slice(0, 300));
    return {
      message:
        "Disculpá, tuve un inconveniente técnico. ¿Podés repetir tu mensaje?",
      state: "GREETING",
      action: null,
    };
  }
}
