import { EventEmitter } from "events";

export type BotEvent =
  | { type: "user_message"; waId: string; displayName: string; text: string; ts: number }
  | { type: "bot_reply"; waId: string; text: string; ts: number }
  | { type: "lead_qualified"; waId: string; displayName: string; ts: number }
  | { type: "lead_disqualified"; waId: string; displayName: string; ts: number }
  | { type: "meeting_booked"; waId: string; displayName: string; scheduledAt: string; ts: number };

class BotEventEmitter extends EventEmitter {}

export const botEvents = new BotEventEmitter();
