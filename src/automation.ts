// Estado de automatización por waId — en memoria, default true
const automationState = new Map<string, boolean>();

export function isAutomationEnabled(waId: string): boolean {
  return automationState.get(waId) ?? true;
}

export function setAutomation(waId: string, enabled: boolean): void {
  automationState.set(waId, enabled);
}
