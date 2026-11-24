import type { AgentSessionSummary } from '../agent/types.ts';

export type SessionGroup = {
  label: 'Bugün' | 'Dün' | 'Daha eski';
  items: AgentSessionSummary[];
};

export function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'az önce';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} dk`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} sa`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} gün`;
}

export function groupSessionsByDate(sessions: AgentSessionSummary[]): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const today: AgentSessionSummary[] = [];
  const yesterday: AgentSessionSummary[] = [];
  const older: AgentSessionSummary[] = [];

  for (const s of sessions) {
    const ts = Date.parse(s.updatedAt);
    if (!Number.isFinite(ts)) {
      older.push(s);
    } else if (ts >= startOfToday) {
      today.push(s);
    } else if (ts >= startOfYesterday) {
      yesterday.push(s);
    } else {
      older.push(s);
    }
  }

  const groups: SessionGroup[] = [];
  if (today.length > 0) groups.push({ label: 'Bugün', items: today });
  if (yesterday.length > 0) groups.push({ label: 'Dün', items: yesterday });
  if (older.length > 0) groups.push({ label: 'Daha eski', items: older });
  return groups;
}
