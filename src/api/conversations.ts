import { Router, Request, Response } from "express";
import { getAllConversations, getConversationHistory } from "../db/conversations";
import { getAllLeads, getLeadByWaId } from "../leads/manager";
import { botEvents, BotEvent } from "../events/emitter";

export const apiRouter = Router();

// ─── Leads ────────────────────────────────────────────────────────────────────
apiRouter.get("/leads", async (_req: Request, res: Response) => {
  const leads = await getAllLeads();
  res.json(leads);
});

apiRouter.get("/leads/:waId", async (req: Request, res: Response) => {
  const lead = await getLeadByWaId(String(req.params.waId));
  if (!lead) {
    res.status(404).json({ error: "Lead no encontrado" });
    return;
  }
  res.json(lead);
});

// ─── Conversaciones ───────────────────────────────────────────────────────────
apiRouter.get("/conversations", async (_req: Request, res: Response) => {
  const conversations = await getAllConversations();
  res.json(conversations);
});

apiRouter.get("/conversations/:waId", async (req: Request, res: Response) => {
  const messages = await getConversationHistory(String(req.params.waId), 100);
  res.json(messages);
});

// ─── SSE — eventos en tiempo real ─────────────────────────────────────────────
apiRouter.get("/stream/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const onEvent = (event: BotEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  botEvents.on("event", onEvent);

  // Ping cada 30s para mantener la conexión
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 30_000);

  req.on("close", () => {
    botEvents.off("event", onEvent);
    clearInterval(ping);
  });
});
