
// Solo frases donde el usuario pide explícitamente cotizar o contratar un bot
const DEMO_KEYWORDS = [
  "cotizar un bot",
  "cotizar el bot",
  "quiero cotizar",
  "quiero un bot",
  "necesito un bot",
  "quiero el bot",
  "contratar el bot",
  "comprar el bot",
  "cuánto cuesta el bot",
  "precio del bot",
  "bot de whatsapp",
  "bot para whatsapp",
];

// Estado en memoria — si el servidor reinicia, Devapli recupera el estado por su cuenta
const activeDemos = new Map<string, boolean>();

export function detectBotIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return DEMO_KEYWORDS.some((kw) => lower.includes(kw));
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
