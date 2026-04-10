import { Router, Request, Response } from "express";
import crypto from "crypto";
import { WHATSAPP, HUMAN_BEHAVIOR } from "../config";
import { processMessage } from "../bot/flow";
import { sendWithHumanDelay, markAsRead, sendReaction } from "../whatsapp/sender";
import { transcribeAudio } from "../whatsapp/transcribe";
import { handleConfirmationReply } from "../reminders/scheduler";

export const webhookRouter = Router();

// ─── Verificación del webhook (GET) ──────────────────────────────────────────
webhookRouter.get("/", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP.verifyToken) {
    console.log("[webhook] ✅ Verificación exitosa");
    res.status(200).send(challenge);
  } else {
    console.warn("[webhook] ❌ Token de verificación incorrecto");
    res.sendStatus(403);
  }
});

// ─── Recepción de mensajes (POST) ─────────────────────────────────────────────
webhookRouter.post("/", verifySignature, (req: Request, res: Response) => {
  // Responder 200 inmediatamente para evitar reintentos de Meta
  res.sendStatus(200);

  const body = req.body;
  console.log("[webhook] POST recibido:", JSON.stringify(body).slice(0, 200));

  if (body.object !== "whatsapp_business_account") return;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const value = change.value;

      // Verificar que el mensaje es para nuestro número
      if (value.metadata?.phone_number_id !== WHATSAPP.phoneNumberId) {
        console.log(
          `[webhook] Ignorando evento de otro phone_number_id: ${value.metadata?.phone_number_id}`
        );
        continue;
      }

      for (const msg of value.messages ?? []) {
        const waId: string = msg.from;
        const displayName: string =
          value.contacts?.find((c: { wa_id: string }) => c.wa_id === waId)?.profile?.name ?? waId;

        handleIncoming(waId, displayName, msg).catch((err) => {
          console.error(`[webhook] Error procesando mensaje de ${waId}:`, err);
        });
      }
    }
  }
});

// ─── Manejo de mensajes con debounce ─────────────────────────────────────────
const debounceMap = new Map<string, { timer: ReturnType<typeof setTimeout>; texts: string[]; lastMsgId: string }>();

async function handleIncoming(
  waId: string,
  displayName: string,
  msg: Record<string, unknown>
): Promise<void> {
  let text = "";
  const msgId = msg.id as string;

  // Extraer texto según tipo de mensaje
  if (msg.type === "text") {
    text = (msg.text as { body: string })?.body?.trim() ?? "";
  } else if (msg.type === "audio") {
    const audio = msg.audio as { id: string; mime_type: string };
    console.log(`[webhook] Audio recibido de ${waId} — transcribiendo...`);
    text = await transcribeAudio(audio.id, audio.mime_type);
    if (!text) {
      await markAsRead(msgId);
      await sendWithHumanDelay(
        waId,
        "No pude escuchar bien el audio. ¿Podés escribirme el mensaje?"
      );
      return;
    }
    console.log(`[webhook] Transcripción: "${text}"`);
  } else {
    // Ignorar stickers, imágenes, etc.
    console.log(`[webhook] Tipo de mensaje no soportado: ${msg.type}`);
    return;
  }

  if (!text) return;

  console.log(`[webhook] Mensaje de ${waId} (${displayName}): "${text.slice(0, 80)}"`);

  // Marcar como leído inmediatamente
  await markAsRead(msgId);

  // Reacción a agradecimientos
  if (/^(gracias|thanks|thank you|perfecto|excelente|genial|ok|listo)[\s!.]*$/i.test(text)) {
    await sendReaction(waId, msgId, "❤️");
  }

  // Debounce: acumular mensajes rápidos del mismo usuario
  const existing = debounceMap.get(waId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.texts.push(text);
    existing.lastMsgId = msgId;
  }

  const entry = debounceMap.get(waId) ?? { timer: undefined as unknown as ReturnType<typeof setTimeout>, texts: [text], lastMsgId: msgId };
  if (!debounceMap.has(waId)) debounceMap.set(waId, entry);

  entry.timer = setTimeout(async () => {
    debounceMap.delete(waId);
    const combined = entry.texts.join(" ");
    await processAndReply(waId, displayName, combined);
  }, HUMAN_BEHAVIOR.debounceMs);
}

async function processAndReply(
  waId: string,
  displayName: string,
  text: string
): Promise<void> {
  try {
    // ── Interceptar respuestas de confirmación de recordatorio ────────────
    const confirmationReply = await handleConfirmationReply(waId, text);
    if (confirmationReply) {
      await sendWithHumanDelay(waId, confirmationReply);
      return;
    }

    // ── Flujo normal con Claude ───────────────────────────────────────────
    const replies = await processMessage(waId, displayName, text);
    for (const reply of replies) {
      await sendWithHumanDelay(waId, reply);
    }
  } catch (error) {
    console.error(`[webhook] Error procesando/respondiendo a ${waId}:`, error);
  }
}

// ─── Middleware de verificación de firma HMAC ─────────────────────────────────
function verifySignature(req: Request, res: Response, next: () => void): void {
  const signature = req.headers["x-hub-signature-256"] as string;

  if (!WHATSAPP.appSecret) {
    console.warn("[webhook] META_APP_SECRET no configurado — saltando verificación");
    next();
    return;
  }

  if (!signature) {
    console.warn("[webhook] ❌ Sin cabecera x-hub-signature-256");
    res.sendStatus(403);
    return;
  }

  // Meta firma el body RAW, no el JSON re-serializado
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    console.warn("[webhook] ❌ rawBody no disponible");
    res.sendStatus(403);
    return;
  }

  const expected = "sha256=" + crypto
    .createHmac("sha256", WHATSAPP.appSecret)
    .update(rawBody)
    .digest("hex");

  if (signature !== expected) {
    console.warn("[webhook] ❌ Firma inválida");
    res.sendStatus(403);
    return;
  }

  console.log("[webhook] ✅ Firma válida");
  next();
}
