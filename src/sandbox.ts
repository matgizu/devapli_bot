/**
 * Sandbox de prueba — simula conversaciones con el bot desde la terminal.
 * No requiere WhatsApp, Cal.com ni base de datos.
 *
 * Uso:
 *   npx ts-node src/sandbox.ts
 *   npx ts-node src/sandbox.ts --slots   ← simula slots de calendario falsos
 */

import "dotenv/config";
import * as readline from "readline";
import { getSession, updateSession } from "./bot/session";
import { askClaude } from "./bot/brain";
import { CalendarSlot } from "./calendar/client";

const WAI_D = "TEST_USER_001";
const DISPLAY_NAME = "Cliente Prueba";

// ─── Slots falsos para simular el calendario ──────────────────────────────────
function fakeSlotsForNextWeek(): CalendarSlot[] {
  const slots: CalendarSlot[] = [];
  const base = new Date();
  base.setHours(10, 0, 0, 0);

  for (let day = 1; day <= 5; day++) {
    const d = new Date(base);
    d.setDate(base.getDate() + day);
    // Saltar fines de semana
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    for (const hour of [10, 15]) {
      d.setHours(hour);
      slots.push({
        id: `fake-slot-${day}-${hour}`,
        time: d.toISOString(),
      });
    }
    if (slots.length >= 5) break;
  }
  return slots;
}

// ─── Colores para la terminal ─────────────────────────────────────────────────
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

function printBot(text: string) {
  console.log(
    `\n${colors.cyan}${colors.bold}🤖 Aria:${colors.reset} ${colors.cyan}${text}${colors.reset}\n`
  );
}

function printUser(text: string) {
  console.log(
    `${colors.green}${colors.bold}👤 Vos:${colors.reset} ${colors.green}${text}${colors.reset}`
  );
}

function printInfo(text: string) {
  console.log(`${colors.gray}   ℹ️  ${text}${colors.reset}`);
}

function printAction(text: string) {
  console.log(`${colors.yellow}   ⚡ ACTION: ${text}${colors.reset}`);
}

function printState(state: string) {
  const stateColors: Record<string, string> = {
    GREETING: colors.magenta,
    QUALIFYING: colors.yellow,
    DISQUALIFIED: colors.red,
    SCHEDULING: colors.cyan,
    CONFIRMED: colors.green,
  };
  const color = stateColors[state] ?? colors.gray;
  console.log(`${color}   📍 Estado: ${state}${colors.reset}`);
}

// ─── Loop principal ───────────────────────────────────────────────────────────
async function main() {
  const useRealSlots = process.argv.includes("--real-slots");
  const fakeSlots = fakeSlotsForNextWeek();

  console.clear();
  console.log(`
${colors.bold}╔══════════════════════════════════════════════════════╗
║        BOT AGENCIA — Sandbox de Conversación         ║
║  Escribe mensajes como si fueras un cliente          ║
║  Comandos:  /reset  /estado  /lead  /salir           ║
╚══════════════════════════════════════════════════════╝${colors.reset}
`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${colors.red}❌ Falta ANTHROPIC_API_KEY en el .env${colors.reset}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const session = getSession(WAI_D, DISPLAY_NAME);

  // Primer mensaje automático del bot
  printInfo("Iniciando conversación...");
  await sendAndPrint("hola", fakeSlots, useRealSlots);

  process.stdout.write(`\n${colors.bold}> ${colors.reset}`);

  rl.on("line", async (input: string) => {
    const text = input.trim();
    if (!text) {
      process.stdout.write(`${colors.bold}> ${colors.reset}`);
      return;
    }

    // Comandos internos
    if (text === "/salir" || text === "/exit") {
      console.log(`\n${colors.dim}Hasta luego.${colors.reset}\n`);
      process.exit(0);
    }

    if (text === "/reset") {
      // Resetear sesión
      updateSession(WAI_D, {
        state: "GREETING",
        history: [],
        lead: { phone: WAI_D },
        availableSlots: undefined,
        meetingBooked: false,
      });
      console.log(`\n${colors.yellow}🔄 Sesión reiniciada.${colors.reset}\n`);
      await sendAndPrint("hola", fakeSlots, useRealSlots);
      process.stdout.write(`${colors.bold}> ${colors.reset}`);
      return;
    }

    if (text === "/estado") {
      const s = getSession(WAI_D, DISPLAY_NAME);
      console.log(
        `\n${colors.dim}Estado actual: ${s.state}\nLead: ${JSON.stringify(s.lead, null, 2)}${colors.reset}\n`
      );
      process.stdout.write(`${colors.bold}> ${colors.reset}`);
      return;
    }

    if (text === "/lead") {
      const s = getSession(WAI_D, DISPLAY_NAME);
      console.log(`\n${colors.dim}${JSON.stringify(s.lead, null, 2)}${colors.reset}\n`);
      process.stdout.write(`${colors.bold}> ${colors.reset}`);
      return;
    }

    printUser(text);
    await sendAndPrint(text, fakeSlots, useRealSlots);
    process.stdout.write(`${colors.bold}> ${colors.reset}`);
  });

  rl.on("close", () => process.exit(0));
}

async function sendAndPrint(
  userText: string,
  fakeSlots: CalendarSlot[],
  useRealSlots: boolean
): Promise<void> {
  const session = getSession(WAI_D, DISPLAY_NAME);

  // Agregar mensaje del usuario al historial
  session.history.push({ role: "user", content: userText });

  try {
    // Primera llamada a Claude
    let response = await askClaude(session, userText);

    // Simular CHECK_CALENDAR
    if (response.action === "CHECK_CALENDAR") {
      printAction("CHECK_CALENDAR — inyectando slots de calendario");

      let slots: CalendarSlot[];
      if (useRealSlots) {
        const { calendarClient } = await import("./calendar/client");
        slots = await calendarClient.getAvailableSlots();
        printInfo(`Slots reales obtenidos: ${slots.length}`);
      } else {
        slots = fakeSlots;
        printInfo(`Slots simulados: ${slots.length}`);
      }

      updateSession(WAI_D, { availableSlots: slots });
      response = await askClaude(session, userText, slots);
    }

    // Simular BOOK_MEETING
    if (response.action === "BOOK_MEETING") {
      if (useRealSlots) {
        printAction("BOOK_MEETING — reservando en Cal.com (real)...");
        const { calendarClient } = await import("./calendar/client");
        const lead = session.lead;
        if (lead.selectedSlot && lead.email) {
          const result = await calendarClient.bookSlot({
            slotTime: lead.selectedSlot,
            slotId: lead.slotId,
            attendeeName: lead.name ?? DISPLAY_NAME,
            attendeeEmail: lead.email,
            attendeePhone: WAI_D,
          });
          printInfo(
            result.success
              ? `✅ Reunión creada — ID: ${result.calendarEventId}`
              : `❌ Error: ${result.error}`
          );
        }
      } else {
        printAction("BOOK_MEETING — simulado (sin llamada real a Cal.com)");
        printInfo(`Slot: ${session.lead.selectedSlot ?? "no definido"}`);
        printInfo(`Email: ${session.lead.email ?? "no definido"}`);
        printInfo("✅ Reserva simulada exitosa");
      }

      updateSession(WAI_D, { meetingBooked: true, state: "CONFIRMED" });
    }

    // Aplicar actualizaciones al lead
    if (response.leadUpdate) {
      const lead = session.lead;
      const u = response.leadUpdate as Record<string, unknown>;
      if (u.name) lead.name = u.name as string;
      if (u.email) lead.email = u.email as string;
      if (u.businessName) lead.businessName = u.businessName as string;
      if (u.businessType) lead.businessType = u.businessType as string;
      if (u.monthlyBudget) lead.monthlyBudget = u.monthlyBudget as string;
      if (u.budgetAmount != null) lead.budgetAmount = Number(u.budgetAmount);
      if (u.businessAge) lead.businessAge = u.businessAge as string;
      if (u.businessAgeMonths != null) lead.businessAgeMonths = Number(u.businessAgeMonths);
      if (u.qualified !== undefined && u.qualified !== null) lead.qualified = u.qualified as boolean;
      if (u.disqualified !== undefined) lead.disqualified = u.disqualified as boolean;
      if (u.selectedSlot) lead.selectedSlot = u.selectedSlot as string;
      if (u.slotId) lead.slotId = u.slotId as string;
      updateSession(WAI_D, { lead, state: response.state });
    }

    // Mostrar estado y respuesta
    printState(response.state);
    printBot(response.message);

    // Guardar en historial
    session.history.push({ role: "assistant", content: response.message });
  } catch (error) {
    console.error(`\n${colors.red}❌ Error:${colors.reset}`, error);
  }
}

main().catch(console.error);
