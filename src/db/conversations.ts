import { prisma } from "./prisma";

// Cache en memoria para evitar buscar el conversationId en cada mensaje
const convIdCache = new Map<string, string>();

async function getOrCreateConversation(waId: string): Promise<string> {
  const cached = convIdCache.get(waId);
  if (cached) return cached;

  let conv = await prisma.conversation.findFirst({ where: { waId } });
  if (!conv) {
    conv = await prisma.conversation.create({ data: { waId } });
  }

  convIdCache.set(waId, conv.id);
  return conv.id;
}

export async function persistMessage(
  waId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  try {
    const conversationId = await getOrCreateConversation(waId);
    await prisma.message.create({
      data: { conversationId, role, content },
    });
  } catch (error) {
    console.error("[db] Error persistiendo mensaje:", error);
  }
}

export async function getConversationHistory(waId: string, limit = 50) {
  const conv = await prisma.conversation.findFirst({
    where: { waId },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: limit,
      },
    },
  });

  if (!conv) return [];
  return conv.messages.reverse();
}

export async function getAllConversations() {
  return prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}
