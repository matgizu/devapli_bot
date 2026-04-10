import { google } from "googleapis";
import { CALENDAR, AGENCY } from "../config";

export interface CalendarSlot {
  id: string;    // ISO datetime — se usa como ID para reservar
  time: string;  // ISO datetime
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

// ─── Google Calendar ──────────────────────────────────────────────────────────
class GoogleCalendarClient implements CalendarProvider {
  private readonly calendarId: string;
  private readonly tz: string;

  constructor() {
    this.calendarId = CALENDAR.google.calendarId;
    this.tz = CALENDAR.timezone;
  }

  private getClient() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: CALENDAR.google.clientEmail,
        private_key: CALENDAR.google.privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return google.calendar({ version: "v3", auth });
  }

  async getAvailableSlots(): Promise<CalendarSlot[]> {
    const calendar = this.getClient();
    const now = new Date();
    const end = new Date(now.getTime() + CALENDAR.daysAhead * 24 * 60 * 60 * 1000);

    try {
      // Consultar períodos ocupados
      const freeBusy = await calendar.freebusy.query({
        requestBody: {
          timeMin: now.toISOString(),
          timeMax: end.toISOString(),
          timeZone: this.tz,
          items: [{ id: this.calendarId }],
        },
      });

      const busyPeriods = (freeBusy.data.calendars?.[this.calendarId]?.busy ?? []).map(
        (b) => ({ start: new Date(b.start!), end: new Date(b.end!) })
      );

      // Generar slots candidatos dentro del horario laboral
      const slots: CalendarSlot[] = [];
      const cursor = new Date(now);
      cursor.setMinutes(0, 0, 0);
      cursor.setHours(cursor.getHours() + 1); // Empezar desde la próxima hora completa

      while (cursor < end && slots.length < CALENDAR.maxSlotsToShow) {
        const localHour = this.localHour(cursor);
        const dayOfWeek = this.localDay(cursor); // 0=dom, 6=sab

        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
        const isWorkingHour =
          localHour >= CALENDAR.workingHours.start &&
          localHour < CALENDAR.workingHours.end;

        if (isWeekday && isWorkingHour) {
          const slotEnd = new Date(cursor.getTime() + CALENDAR.meetingDurationMin * 60 * 1000);
          const isFree = !busyPeriods.some(
            (b) => cursor < b.end && slotEnd > b.start
          );

          if (isFree) {
            slots.push({ id: cursor.toISOString(), time: cursor.toISOString() });
          }
        }

        cursor.setHours(cursor.getHours() + 1);
      }

      return slots;
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error("[calendar] Error obteniendo slots de Google Calendar:", err.message);
      return [];
    }
  }

  async bookSlot(details: BookingDetails): Promise<BookingResult> {
    const calendar = this.getClient();
    const start = new Date(details.slotTime);
    const end = new Date(start.getTime() + CALENDAR.meetingDurationMin * 60 * 1000);

    try {
      const event = await calendar.events.insert({
        calendarId: this.calendarId,
        conferenceDataVersion: 1,
        requestBody: {
          summary: `${AGENCY.meetingTitle} — ${details.attendeeName}`,
          description:
            `${AGENCY.meetingDescription}\n\nTeléfono: ${details.attendeePhone}`,
          start: { dateTime: start.toISOString(), timeZone: details.timezone ?? this.tz },
          end: { dateTime: end.toISOString(), timeZone: details.timezone ?? this.tz },
          attendees: [
            { email: details.attendeeEmail, displayName: details.attendeeName },
          ],
          conferenceData: {
            createRequest: {
              requestId: `meet-${Date.now()}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        },
      });

      return {
        success: true,
        calendarEventId: event.data.id ?? undefined,
        meetingUrl: event.data.hangoutLink ?? undefined,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error("[calendar] Error creando evento en Google Calendar:", err.message);
      return { success: false, error: err.message };
    }
  }

  // Hora local en Bogotá (UTC-5)
  private localHour(date: Date): number {
    return parseInt(
      date.toLocaleString("es-CO", { hour: "numeric", hour12: false, timeZone: this.tz }),
      10
    );
  }

  // Día de la semana local en Bogotá
  private localDay(date: Date): number {
    return new Date(date.toLocaleString("en-US", { timeZone: this.tz })).getDay();
  }
}

// ─── Proveedor custom (para futuras integraciones) ────────────────────────────
class CustomCalendarClient implements CalendarProvider {
  async getAvailableSlots(): Promise<CalendarSlot[]> {
    // TODO: implementar cuando sea necesario
    return [];
  }
  async bookSlot(_details: BookingDetails): Promise<BookingResult> {
    return { success: false, error: "Proveedor custom no implementado" };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
export function createCalendarClient(): CalendarProvider {
  if (CALENDAR.provider === "custom") return new CustomCalendarClient();
  return new GoogleCalendarClient();
}

export const calendarClient = createCalendarClient();
