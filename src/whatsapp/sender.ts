import axios from "axios";
import { WHATSAPP, HUMAN_BEHAVIOR, PROOF_IMAGES } from "../config";

const BASE_URL = `https://graph.facebook.com/v21.0/${WHATSAPP.phoneNumberId}`;

function typingDelay(text: string): number {
  const words = text.split(/\s+/).length;
  const delay = HUMAN_BEHAVIOR.typingBaseMs + words * HUMAN_BEHAVIOR.typingPerWordMs;
  return Math.min(delay, HUMAN_BEHAVIOR.typingMaxMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(endpoint: string, body: object): Promise<void> {
  await axios.post(`${BASE_URL}${endpoint}`, body, {
    headers: {
      Authorization: `Bearer ${WHATSAPP.token}`,
      "Content-Type": "application/json",
    },
  });
}

export async function sendText(to: string, text: string): Promise<void> {
  await post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text, preview_url: false },
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  try {
    await post("/messages", {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  } catch {
    // No es crítico
  }
}

export async function sendReaction(to: string, messageId: string, emoji: string): Promise<void> {
  try {
    await post("/messages", {
      messaging_product: "whatsapp",
      to,
      type: "reaction",
      reaction: { message_id: messageId, emoji },
    });
  } catch {
    // No es crítico
  }
}

export async function sendImageByUrl(to: string, imageUrl: string, caption?: string): Promise<void> {
  await post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link: imageUrl,
      ...(caption && { caption }),
    },
  });
}

// Envía todas las imágenes de prueba configuradas, con delay entre cada una
export async function sendProofImages(to: string): Promise<void> {
  for (const img of PROOF_IMAGES) {
    await sleep(1200);
    await sendImageByUrl(to, img.url, img.caption || undefined);
  }
}

// Divide el texto en párrafos y los envía con delay humano entre cada uno
export async function sendWithHumanDelay(to: string, text: string): Promise<void> {
  const parts = splitMessage(text);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    await sleep(typingDelay(part));
    await sendText(to, part);
  }
}

// Divide en partes por \n\n o por longitud máxima
function splitMessage(text: string, maxLength = 1500): string[] {
  if (text.length <= maxLength) return [text];

  const paragraphs = text.split(/\n\n+/);
  const parts: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > maxLength && current) {
      parts.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter((p) => p.length > 0);
}
