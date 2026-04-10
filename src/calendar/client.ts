import { CALENDAR, AGENCY } from "../config";
import { prisma } from "../db/prisma";

export interface CalendarSlot {
  id: string;    // ISO datetime — se usa como referencia al reservar
  time: string;  // ISO datetime UTC
}

export interface BookingResult {
  success: boolean;
  calendarEventId?: string;
  meetingUrl?: string;
  error?: string;
}

export interface BookingDetails {
  slotTime: string;
  slotId?: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone: string;
  timezone?: string;
}

export interface CalendarProvider {
  getAvailableSlots(): Promise<CalendarSlot[]>;
  bookSlot(details: BookingDetails): Promise<BookingResult>;
}

// ─── Helpers de timezone Colombia (UTC-5, sin DST) ───────────────────────────

function toCOT(date: Date): Date {
  // Convierte a la hora local de Bogotá para poder leer day/hour correctamente
  return new Date(date.toLocaleString("en-US", { timeZone: "America/Bogota" }));
}

// ─── Disponibilidad hardcodeada: Lun-Sáb 2pm-6pm Colombia ───────────────────

class LocalScheduleClient implements CalendarProvider {
  async getAvailableSlots(): Promise<CalendarSlot[]> {
    const now = new Date();
    const endDate = new Date(now.getTime() + CALENDAR.daysAhead * 24 * 60 * 60 * 1000);

    // Traer reuniones ya agendadas (no canceladas)
    const booked = await prisma.meeting.findMany({
      where: {
        scheduledAt: { gte: now, lte: endDate },
        status: { not: "CANCELLED" },
      },
      select: { scheduledAt: true, endsAt: true },
    });

    const slots: CalendarSlot[] = [];

    // Empezar en el siguiente bloque de 30 minutos completo
    const cursor = new Date(now);
    cursor.setSeconds(0, 0);
    const m = cursor.getMinutes();
    cursor.setMinutes(m < 30 ? 30 : 60, 0, 0); // redondear al siguiente :00 o :30

    while (cursor < endDate && slots.length < CALENDAR.maxSlotsToShow) {
      const local = toCOT(cursor);
      const day = local.getDay();   // 0=dom, 1=lun … 6=sáb
      const hour = local.getHours();
      const minute = local.getMinutes();

      const isWorkingDay = day >= 1 && day <= 6;                     // Lun–Sáb
      const isWorkingSlot = hour >= 14 && (hour < 18 || (hour === 17 && minute === 30)); // 14:00–17:30

      if (isWorkingDay && isWorkingSlot) {
        const slotEnd = new Date(cursor.getTime() + CALENDAR.meetingDurationMin * 60 * 1000);
        const isBusy = booked.some(
          (b) => cursor < b.endsAt && slotEnd > b.scheduledAt
        );

        if (!isBusy) {
          slots.push({ id: cursor.toISOString(), time: cursor.toISOString() });
        }
      }

      // Avanzar 30 minutos
      cursor.setMinutes(cursor.getMinutes() + 30);
    }

    return slots;
  }

  async bookSlot(_details: BookingDetails): Promise<BookingResult> {
    // La reserva real la hace flow.ts via createMeeting() en la DB
    // Este método existe para mantener la interfaz consistente
    return { success: true };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCalendarClient(): CalendarProvider {
  return new LocalScheduleClient();
}

export const calendarClient = createCalendarClient();
