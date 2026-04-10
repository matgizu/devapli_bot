import axios from "axios";
import { CALENDAR } from "../config";

export interface CalendarSlot {
  id: string;       // ID único del slot para hacer la reserva
  time: string;     // ISO datetime (ej: "2024-01-15T10:00:00.000Z")
}

export interface BookingResult {
  success: boolean;
  calendarEventId?: string;
  meetingUrl?: string;
  error?: string;
}

export interface BookingDetails {
  slotTime: string;  // ISO datetime
  slotId?: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone: string;
  timezone?: string;
}

// ─── Interfaz común para cualquier proveedor ──────────────────────────────────
export interface CalendarProvider {
  getAvailableSlots(): Promise<CalendarSlot[]>;
  bookSlot(details: BookingDetails): Promise<BookingResult>;
}

// ─── Implementación Cal.com v2 ────────────────────────────────────────────────
class CalComClient implements CalendarProvider {
  private readonly headers: Record<string, string>;
  private readonly baseUrl: string;
  private readonly eventTypeId: number;
  private readonly eventTypeSlug: string;
  private readonly username: string;
  private readonly timezone: string;

  constructor() {
    const cfg = CALENDAR.calcom;
    this.baseUrl = cfg.baseUrl;
    this.eventTypeId = cfg.eventTypeId;
    this.eventTypeSlug = cfg.eventTypeSlug;
    this.username = cfg.username;
    this.timezone = CALENDAR.timezone;
    this.headers = {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "cal-api-version": "2024-08-13",
    };
  }

  async getAvailableSlots(): Promise<CalendarSlot[]> {
    const now = new Date();
    const start = now.toISOString();
    const end = new Date(
      now.getTime() + CALENDAR.daysAhead * 24 * 60 * 60 * 1000
    ).toISOString();

    try {
      const res = await axios.get(`${this.baseUrl}/slots/available`, {
        headers: this.headers,
        params: {
          startTime: start,
          endTime: end,
          eventTypeId: this.eventTypeId,
          eventTypeSlug: this.eventTypeSlug,
          username: this.username,
        },
      });

      // Cal.com v2 responde con data.slots (objeto con fechas como llaves)
      const slotsData: Record<string, { time: string }[]> =
        res.data?.data?.slots ?? res.data?.slots ?? {};

      const slots: CalendarSlot[] = [];
      for (const daySlots of Object.values(slotsData)) {
        for (const s of daySlots) {
          slots.push({
            id: s.time, // En Cal.com v2 el time mismo funciona como ID para reservar
            time: s.time,
          });
        }
      }

      // Tomar los primeros N slots disponibles
      return slots.slice(0, CALENDAR.maxSlotsToShow);
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      console.error(
        "[calendar] Error obteniendo slots de Cal.com:",
        err.response?.data ?? err.message
      );
      return [];
    }
  }

  async bookSlot(details: BookingDetails): Promise<BookingResult> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/bookings`,
        {
          start: details.slotTime,
          eventTypeId: this.eventTypeId,
          attendee: {
            name: details.attendeeName,
            email: details.attendeeEmail,
            timeZone: details.timezone ?? this.timezone,
            phoneNumber: details.attendeePhone,
          },
          meetingUrl: "https://cal.com/video", // Cal.com agrega el link automáticamente
        },
        { headers: this.headers }
      );

      const booking = res.data?.data ?? res.data;
      return {
        success: true,
        calendarEventId: String(booking?.id ?? booking?.uid ?? ""),
        meetingUrl: booking?.videoCallUrl ?? booking?.meetingUrl ?? undefined,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      console.error(
        "[calendar] Error creando booking en Cal.com:",
        err.response?.data ?? err.message
      );
      return { success: false, error: String(err.message ?? "Error desconocido") };
    }
  }
}

// ─── Implementación personalizada (para la API que el usuario provea) ─────────
// TODO: cuando el usuario provea su API de calendario, implementar aquí
class CustomCalendarClient implements CalendarProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = CALENDAR.custom.baseUrl;
    this.apiKey = CALENDAR.custom.apiKey;
  }

  async getAvailableSlots(): Promise<CalendarSlot[]> {
    // TODO: implementar según la API del usuario
    // Ejemplo genérico:
    const res = await axios.get(`${this.baseUrl}/slots`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return res.data.slots as CalendarSlot[];
  }

  async bookSlot(details: BookingDetails): Promise<BookingResult> {
    // TODO: implementar según la API del usuario
    const res = await axios.post(
      `${this.baseUrl}/bookings`,
      { slot: details.slotTime, attendee: details },
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    return { success: true, calendarEventId: res.data.id };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
export function createCalendarClient(): CalendarProvider {
  if (CALENDAR.provider === "custom") {
    return new CustomCalendarClient();
  }
  return new CalComClient();
}

export const calendarClient = createCalendarClient();
