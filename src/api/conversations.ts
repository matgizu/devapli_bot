import { Router, Request, Response } from "express";
import { prisma } from "../db/prisma";
import { botEvents, BotEvent } from "../events/emitter";
import { sendText } from "../whatsapp/sender";
import { persistMessage } from "../db/conversations";
import { isAutomationEnabled, setAutomation } from "../automation";
import { getSessionState, pushToSessionHistory, updateSession, getExistingSession } from "../bot/session";

export const apiRouter = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════════════════

apiRouter.get("/leads", async (_req: Request, res: Response) => {
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: "desc" },
    include: { meetings: { orderBy: { scheduledAt: "asc" } } },
  });
  res.json(leads);
});

apiRouter.get("/leads/qualified", async (_req: Request, res: Response) => {
  const leads = await prisma.lead.findMany({
    where: { qualified: true },
    orderBy: { createdAt: "desc" },
    include: { meetings: true },
  });
  res.json(leads);
});

apiRouter.get("/leads/disqualified", async (_req: Request, res: Response) => {
  const leads = await prisma.lead.findMany({
    where: { disqualified: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(leads);
});

apiRouter.get("/leads/:waId", async (req: Request, res: Response) => {
  const lead = await prisma.lead.findUnique({
    where: { waId: String(req.params.waId) },
    include: { meetings: { orderBy: { scheduledAt: "desc" } } },
  });
  if (!lead) { res.status(404).json({ error: "Lead no encontrado" }); return; }
  res.json(lead);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEETINGS
// ═══════════════════════════════════════════════════════════════════════════════

apiRouter.get("/meetings", async (req: Request, res: Response) => {
  const { status, from, to } = req.query;
  const where: Record<string, unknown> = {};
  if (status) where.status = String(status);
  if (from || to) {
    where.scheduledAt = {
      ...(from && { gte: new Date(String(from)) }),
      ...(to   && { lte: new Date(String(to)) }),
    };
  }
  const meetings = await prisma.meeting.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    include: { lead: { select: { name: true, displayName: true, businessName: true, businessType: true, email: true } } },
  });
  res.json(meetings);
});

apiRouter.get("/meetings/upcoming", async (_req: Request, res: Response) => {
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const meetings = await prisma.meeting.findMany({
    where: {
      scheduledAt: { gte: now, lte: in7d },
      status: { in: ["SCHEDULED", "CONFIRMED"] },
    },
    orderBy: { scheduledAt: "asc" },
    include: { lead: { select: { name: true, displayName: true, businessName: true, email: true } } },
  });
  res.json(meetings);
});

apiRouter.get("/meetings/today", async (_req: Request, res: Response) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const meetings = await prisma.meeting.findMany({
    where: { scheduledAt: { gte: start, lte: end } },
    orderBy: { scheduledAt: "asc" },
    include: { lead: { select: { name: true, displayName: true, businessName: true, email: true } } },
  });
  res.json(meetings);
});

apiRouter.get("/meetings/:id", async (req: Request, res: Response) => {
  const meeting = await prisma.meeting.findUnique({
    where: { id: String(req.params.id) },
    include: { lead: true },
  });
  if (!meeting) { res.status(404).json({ error: "Reunión no encontrada" }); return; }
  res.json(meeting);
});

// Actualizar estado de una reunión (para el módulo externo)
apiRouter.patch("/meetings/:id", async (req: Request, res: Response) => {
  const { status, cancelReason, meetingUrl } = req.body as {
    status?: string;
    cancelReason?: string;
    meetingUrl?: string;
  };
  const validStatuses = ["SCHEDULED", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: `Estado inválido. Válidos: ${validStatuses.join(", ")}` });
    return;
  }
  try {
    const updated = await prisma.meeting.update({
      where: { id: String(req.params.id) },
      data: {
        ...(status && { status }),
        ...(cancelReason && { cancelReason }),
        ...(meetingUrl && { meetingUrl }),
      },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "Reunión no encontrada" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD / TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

apiRouter.get("/dashboard/stats", async (_req: Request, res: Response) => {
  const [
    totalLeads,
    qualifiedLeads,
    disqualifiedLeads,
    pendingLeads,
    totalMeetings,
    scheduledMeetings,
    confirmedMeetings,
    completedMeetings,
    cancelledMeetings,
    noShowMeetings,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { qualified: true } }),
    prisma.lead.count({ where: { disqualified: true } }),
    prisma.lead.count({ where: { qualified: null, disqualified: false } }),
    prisma.meeting.count(),
    prisma.meeting.count({ where: { status: "SCHEDULED" } }),
    prisma.meeting.count({ where: { status: "CONFIRMED" } }),
    prisma.meeting.count({ where: { status: "COMPLETED" } }),
    prisma.meeting.count({ where: { status: "CANCELLED" } }),
    prisma.meeting.count({ where: { status: "NO_SHOW" } }),
  ]);

  const conversionLeadToMeeting =
    qualifiedLeads > 0
      ? Math.round((totalMeetings / qualifiedLeads) * 100)
      : 0;

  const conversionMeetingToComplete =
    totalMeetings > 0
      ? Math.round((completedMeetings / totalMeetings) * 100)
      : 0;

  res.json({
    leads: {
      total: totalLeads,
      qualified: qualifiedLeads,
      disqualified: disqualifiedLeads,
      pending: pendingLeads,
    },
    meetings: {
      total: totalMeetings,
      scheduled: scheduledMeetings,
      confirmed: confirmedMeetings,
      completed: completedMeetings,
      cancelled: cancelledMeetings,
      noShow: noShowMeetings,
    },
    conversion: {
      leadToMeeting: `${conversionLeadToMeeting}%`,
      meetingToComplete: `${conversionMeetingToComplete}%`,
    },
    generatedAt: new Date().toISOString(),
  });
});

apiRouter.get("/dashboard/funnel", async (_req: Request, res: Response) => {
  // Funnel últimos 30 días
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [leads30d, meetings30d, confirmed30d, completed30d] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: since } } }),
    prisma.meeting.count({ where: { createdAt: { gte: since } } }),
    prisma.meeting.count({ where: { createdAt: { gte: since }, status: "CONFIRMED" } }),
    prisma.meeting.count({ where: { createdAt: { gte: since }, status: "COMPLETED" } }),
  ]);
  res.json({
    period: "últimos 30 días",
    funnel: [
      { stage: "Leads captados", count: leads30d },
      { stage: "Reuniones agendadas", count: meetings30d },
      { stage: "Reuniones confirmadas", count: confirmed30d },
      { stage: "Reuniones completadas", count: completed30d },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSACIONES
// ═══════════════════════════════════════════════════════════════════════════════

apiRouter.get("/conversations", async (_req: Request, res: Response) => {
  const convs = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: true } },
    },
  });

  // Traer leads asociados en paralelo para obtener customerName y estado
  const waIds = convs.map((c) => c.waId);
  const leads = await prisma.lead.findMany({
    where: { waId: { in: waIds } },
    select: { waId: true, name: true, displayName: true, qualified: true, disqualified: true, meetings: { select: { status: true }, take: 1, orderBy: { createdAt: "desc" } } },
  });
  const leadMap = new Map(leads.map((l) => [l.waId, l]));

  const data = convs.map((c) => {
    const lead = leadMap.get(c.waId);

    // Estado: sesión en memoria > derivado de DB
    let state: string = getSessionState(c.waId) ?? deriveStateFromLead(lead);

    return {
      waId: c.waId,
      customerName: lead?.name ?? lead?.displayName ?? null,
      lastActivity: new Date(c.updatedAt).getTime(),
      lastMessage: c.messages[0]?.content ?? "",
      messageCount: c._count.messages,
      state,
    };
  });

  res.json({ ok: true, data });
});

apiRouter.get("/conversations/:waId", async (req: Request, res: Response) => {
  const waId = String(req.params.waId);

  const conv = await prisma.conversation.findFirst({
    where: { waId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conv) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { waId },
    select: { name: true, displayName: true },
  });

  res.json({
    ok: true,
    data: {
      waId,
      customerName: lead?.name ?? lead?.displayName ?? null,
      messages: conv.messages.map((m) => ({
        role: m.role,
        text: m.content,
        ts: new Date(m.createdAt).getTime(),
      })),
    },
  });
});

// ─── POST /conversations/:waId/send ──────────────────────────────────────────
apiRouter.post("/conversations/:waId/send", async (req: Request, res: Response) => {
  const waId = String(req.params.waId);
  const { text } = req.body as { text?: string };

  if (!text?.trim()) {
    res.status(400).json({ ok: false, error: "El campo 'text' es requerido" });
    return;
  }

  try {
    await sendText(waId, text.trim());
    await persistMessage(waId, "assistant", text.trim());
    // Actualizar historial en memoria para que Claude tenga contexto de lo que dijo el humano
    pushToSessionHistory(waId, "assistant", text.trim());
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al enviar mensaje";
    console.error(`[api] Error enviando mensaje manual a ${waId}:`, err);
    res.status(502).json({ ok: false, error: message });
  }
});

// ─── PATCH /conversations/:waId/unpause ──────────────────────────────────────
apiRouter.patch("/conversations/:waId/unpause", (req: Request, res: Response) => {
  const waId = String(req.params.waId);
  const session = getExistingSession(waId);

  if (!session) {
    res.status(404).json({ ok: false, error: "Sesión no encontrada" });
    return;
  }

  updateSession(waId, { paused: false });
  console.log(`[api] Bot despausado para ${waId}`);
  res.json({ ok: true, paused: false });
});

// ─── GET /conversations/:waId/automation ─────────────────────────────────────
apiRouter.get("/conversations/:waId/automation", (req: Request, res: Response) => {
  const waId = String(req.params.waId);
  res.json({ ok: true, enabled: isAutomationEnabled(waId) });
});

// ─── PATCH /conversations/:waId/automation ───────────────────────────────────
apiRouter.patch("/conversations/:waId/automation", (req: Request, res: Response) => {
  const waId = String(req.params.waId);
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== "boolean") {
    res.status(400).json({ ok: false, error: "El campo 'enabled' debe ser boolean" });
    return;
  }

  setAutomation(waId, enabled);
  console.log(`[automation] ${waId} → ${enabled ? "ON" : "OFF"}`);
  res.json({ ok: true, enabled });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SSE — eventos en tiempo real
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helper: deriva estado de conversación desde campos del Lead en DB ────────
function deriveStateFromLead(lead: { qualified?: boolean | null; disqualified?: boolean; meetings?: { status: string }[] } | undefined): string {
  if (!lead) return "GREETING";
  if (lead.meetings && lead.meetings.length > 0) return "CONFIRMED";
  if (lead.disqualified) return "DISQUALIFIED";
  if (lead.qualified === true) return "SCHEDULING";
  if (lead.qualified === false) return "DISQUALIFIED";
  return "QUALIFYING";
}

apiRouter.get("/stream/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const onEvent = (event: BotEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  botEvents.on("event", onEvent);

  const ping = setInterval(() => res.write(": ping\n\n"), 30_000);

  req.on("close", () => {
    botEvents.off("event", onEvent);
    clearInterval(ping);
  });
});
