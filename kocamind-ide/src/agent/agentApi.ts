import type { AgentApi } from './types.ts';

export type AuthUser = {
  uid: string;
  email: string | null;
};

export interface AuthApi {
  login(): Promise<{ ok: true; user: AuthUser } | { error: string }>;
  logout(): Promise<{ ok: true } | { error: string }>;
  state(): Promise<{ loggedIn: boolean; email: string | null; persisted: boolean } | { error: string }>;
}

// Electron uzerindeki agent IPC arayuzune erisim
export function getAgentApi(): AgentApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { electron?: { agent?: AgentApi } }).electron?.agent ?? null;
}

// Electron uzerindeki auth IPC arayuzune erisim
export function getAuthApi(): AuthApi | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { electron?: { auth?: AuthApi } }).electron?.auth ?? null;
}
