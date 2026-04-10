import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE } from "../config";

const client = new Anthropic({ apiKey: CLAUDE.apiKey });

// Keywords específicas de intención de COMPRAR/CONTRATAR un bot — no genéricas
const DEMO_KEYWORDS = [
  "quiero un bot",
  "necesito un bot",
  "bot para mi negocio",
  "quiero el bot",
  "me interesa el bot",
  "precio del bot",
  "comprar el bot",
  "contratar el bot",
  "cuánto cuesta el bot",
  "whatsapp bot",
  "chatbot para",
  "ia para whatsapp",
  "bot de whatsapp",
  "bot para responder",
  "automatizar mis mensajes",
  "automatizar whatsapp",
  "respuestas automáticas para",
];

// Estado en memoria — si el servidor reinicia, Devapli recupera el estado por su cuenta
const activeDemos = new Map<string, boolean>();

export async function detectBotIntent(message: string): Promise<boolean> {
  const lower = message.toLowerCase();
  if (DEMO_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  try {
    const response = await client.messages.create({
      model: CLAUDE.model,
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content:
            `¿Este mensaje indica que la persona quiere COMPRAR o CONTRATAR un bot de WhatsApp o chatbot para automatizar mensajes de su negocio? ` +
            `NO respondas SI si solo menciona inteligencia artificial, marketing digital, automatización de anuncios u otros servicios de agencia. ` +
            `Solo SI si claramente quiere un bot/chatbot de WhatsApp. Responde solo: SI o NO. Mensaje: ${message}`,
        },
      ],
    });
    const text = response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as Anthropic.TextBlock).text)
      .join("")
      .trim();
    return text.startsWith("SI");
  } catch {
    return false;
  }
}

export function isDemoActive(phone: string): boolean {
  return activeDemos.get(phone) === true;
}

export async function callDemoAPI(params: {
  phone: string;
  message: string;
  botPhoneNumberId: string;
  contactName?: string;
}): Promise<{ reply: string; isDemoActive: boolean; phase: string }> {
  const res = await fetch("https://devaplibot-production.up.railway.app/api/whatsapp/demo-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEVAPLI_DEMO_API_KEY}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`[demoBot] Devapli API respondió ${res.status}`);
  }

  const data = (await res.json()) as {
    reply: string;
    phase: string;
    isDemoActive: boolean;
    appointmentBooked?: boolean;
  };

  if (data.phase === "COMPLETED" || data.phase === "NEW") {
    activeDemos.delete(params.phone);
  } else {
    activeDemos.set(params.phone, true);
  }

  return { reply: data.reply, isDemoActive: data.isDemoActive, phase: data.phase };
}
