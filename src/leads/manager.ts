import { prisma } from "../db/prisma";
import { LeadInfo } from "../bot/session";
import { CALENDAR } from "../config";

export async function upsertLead(waId: string, displayName: string, leadInfo: LeadInfo): Promise<void> {
  try {
    await prisma.lead.upsert({
      where: { waId },
      create: {
        waId,
        displayName,
        phone: waId,
        name: leadInfo.name,
        email: leadInfo.email,
        businessName: leadInfo.businessName,
        businessType: leadInfo.businessType,
        monthlyBudget: leadInfo.monthlyBudget,
        budgetAmount: leadInfo.budgetAmount ?? undefined,
        businessAge: leadInfo.businessAge,
        businessAgeMonths: leadInfo.businessAgeMonths ?? undefined,
        qualified: leadInfo.qualified ?? undefined,
        disqualified: leadInfo.disqualified ?? false,
      },
      update: {
        displayName,
        ...(leadInfo.name && { name: leadInfo.name }),
        ...(leadInfo.email && { email: leadInfo.email }),
        ...(leadInfo.businessName && { businessName: leadInfo.businessName }),
        ...(leadInfo.businessType && { businessType: leadInfo.businessType }),
        ...(leadInfo.monthlyBudget && { monthlyBudget: leadInfo.monthlyBudget }),
        ...(leadInfo.budgetAmount != null && { budgetAmount: leadInfo.budgetAmount }),
        ...(leadInfo.businessAge && { businessAge: leadInfo.businessAge }),
        ...(leadInfo.businessAgeMonths != null && { businessAgeMonths: leadInfo.businessAgeMonths }),
        ...(leadInfo.qualified !== undefined && { qualified: leadInfo.qualified ?? undefined }),
        ...(leadInfo.disqualified !== undefined && { disqualified: leadInfo.disqualified }),
      },
    });
  } catch (error) {
    console.error("[leads] Error upserting lead:", error);
  }
}

export async function createMeeting(params: {
  waId: string;
  scheduledAt: Date;
  slotId?: string;
  calendarEventId?: string;
  meetingUrl?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  attendeePhone?: string;
}): Promise<string | null> {
  try {
    const endsAt = new Date(
      params.scheduledAt.getTime() + CALENDAR.meetingDurationMin * 60 * 1000
    );
    const meeting = await prisma.meeting.create({
      data: {
        waId: params.waId,
        scheduledAt: params.scheduledAt,
        endsAt,
        meetingUrl: params.meetingUrl,
        attendeeName: params.attendeeName,
        attendeeEmail: params.attendeeEmail,
        attendeePhone: params.attendeePhone,
        status: "SCHEDULED",
      },
    });
    return meeting.id;
  } catch (error) {
    console.error("[leads] Error creando meeting:", error);
    return null;
  }
}

export async function getMeetingByWaId(waId: string) {
  return prisma.meeting.findFirst({
    where: { waId, status: { in: ["SCHEDULED", "CONFIRMED"] } },
    orderBy: { scheduledAt: "asc" },
  });
}

export async function updateMeetingStatus(
  id: string,
  status: string,
  extra?: { cancelReason?: string; confirmationResponse?: string; confirmedAt?: Date }
) {
  return prisma.meeting.update({
    where: { id },
    data: { status, ...extra },
  });
}

export async function getAllLeads() {
  return prisma.lead.findMany({
    orderBy: { createdAt: "desc" },
    include: { meetings: true },
  });
}

export async function getLeadByWaId(waId: string) {
  return prisma.lead.findUnique({
    where: { waId },
    include: { meetings: true },
  });
}
