// Pre-tax share per member for per_person / split — matches party-lock `computePretaxLedgerCents` (per_person branch).
import type { PartyItem, PartyMember } from './party-session';

function splitCentsEqually(total: number, m: number): number[] {
  if (m <= 0) return [];
  if (total <= 0) return Array(m).fill(0);
  const base = Math.floor(total / m);
  const r = total - base * m;
  return Array.from({ length: m }, (_, j) => base + (j < r ? 1 : 0));
}

/** Cart pre-tax cents attributed to `forMemberId` (each pays their own / split). */
export function memberPretaxCentsPerPerson(
  items: PartyItem[],
  members: PartyMember[],
  forMemberId: string,
  staffManaged: boolean,
): number {
  const ordered = [...members].sort(
    (a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime(),
  );
  const host = ordered.find((m) => m.role === 'host');
  const vHostId = host?.id ?? ordered[0]!.id;
  const vMemberIds = staffManaged
    ? ordered.filter((m) => m.id !== vHostId).map((m) => m.id)
    : ordered.map((m) => m.id);
  const vFallback = staffManaged
    ? (vMemberIds[0] ?? vHostId)
    : (vMemberIds.includes(vHostId) ? vHostId : (vMemberIds[0] ?? vHostId));

  const resolveTarget = (pid: string | null | undefined): string => {
    if (pid && vMemberIds.includes(pid)) return pid;
    return vFallback;
  };

  let acc = 0;
  for (const it of items) {
    const lc = Math.round(Number(it.menu_item?.price ?? 0) * 100) * Math.max(1, it.quantity ?? 1);
    if (lc <= 0) continue;
    let payers: string[];
    if (it.split_member_ids && it.split_member_ids.length >= 1) {
      payers = [...it.split_member_ids];
    } else if (it.added_by_member_id) {
      payers = [it.added_by_member_id];
    } else {
      payers = [vFallback];
    }
    const parts = splitCentsEqually(lc, payers.length);
    payers.forEach((pid, j) => {
      const target = resolveTarget(pid);
      if (target === forMemberId) acc += parts[j] ?? 0;
    });
  }
  return acc;
}

export function isPerPersonPaymentMode(mode: string | null | undefined): boolean {
  return mode === 'per_person' || mode === 'split';
}

export function isAssignedPaymentMode(mode: string | null | undefined): boolean {
  return mode === 'assigned' || mode === 'assign';
}

function assignedLedgerContext(members: PartyMember[], staffManaged: boolean) {
  const ordered = [...members].sort(
    (a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime(),
  );
  const host = ordered.find((m) => m.role === 'host');
  const vHostId = host?.id ?? ordered[0]!.id;
  const vMemberIds = staffManaged
    ? ordered.filter((m) => m.id !== vHostId).map((m) => m.id)
    : ordered.map((m) => m.id);
  const vFallback = staffManaged
    ? (vMemberIds[0] ?? vHostId)
    : (vMemberIds.includes(vHostId) ? vHostId : (vMemberIds[0] ?? vHostId));
  const resolveTarget = (pid: string | null | undefined): string => {
    if (pid && vMemberIds.includes(pid)) return pid;
    return vFallback;
  };
  return { vFallback, resolveTarget };
}

/** Pre-tax for assigned (one payer per line) — matches party-lock assigned branch. */
export function memberPretaxCentsAssigned(
  items: PartyItem[],
  members: PartyMember[],
  forMemberId: string,
  staffManaged: boolean,
): number {
  const { vFallback, resolveTarget } = assignedLedgerContext(members, staffManaged);
  let acc = 0;
  for (const it of items) {
    const lc = Math.round(Number(it.menu_item?.price ?? 0) * 100) * Math.max(1, it.quantity ?? 1);
    if (lc <= 0) continue;
    const mid = (it.assigned_payer_id ?? it.added_by_member_id) ?? vFallback;
    if (resolveTarget(mid) === forMemberId) acc += lc;
  }
  return acc;
}

/** Per-line `tax_cents` on items, split the same way as subtotal for per_person. */
export function memberLineTaxCentsPerPerson(
  items: PartyItem[],
  members: PartyMember[],
  forMemberId: string,
  staffManaged: boolean,
): number {
  const ordered = [...members].sort(
    (a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime(),
  );
  const host = ordered.find((m) => m.role === 'host');
  const vHostId = host?.id ?? ordered[0]!.id;
  const vMemberIds = staffManaged
    ? ordered.filter((m) => m.id !== vHostId).map((m) => m.id)
    : ordered.map((m) => m.id);
  const vFallback = staffManaged
    ? (vMemberIds[0] ?? vHostId)
    : (vMemberIds.includes(vHostId) ? vHostId : (vMemberIds[0] ?? vHostId));

  const resolveTarget = (pid: string | null | undefined): string => {
    if (pid && vMemberIds.includes(pid)) return pid;
    return vFallback;
  };

  let acc = 0;
  for (const it of items) {
    const tc = Math.max(0, it.tax_cents ?? 0);
    if (tc <= 0) continue;
    let payers: string[];
    if (it.split_member_ids && it.split_member_ids.length >= 1) {
      payers = [...it.split_member_ids];
    } else if (it.added_by_member_id) {
      payers = [it.added_by_member_id];
    } else {
      payers = [vFallback];
    }
    const parts = splitCentsEqually(tc, payers.length);
    payers.forEach((pid, j) => {
      const target = resolveTarget(pid);
      if (target === forMemberId) acc += parts[j] ?? 0;
    });
  }
  return acc;
}

/** One payer per line — full `tax_cents` for that line to the assigned payer. */
export function memberLineTaxCentsAssigned(
  items: PartyItem[],
  members: PartyMember[],
  forMemberId: string,
  staffManaged: boolean,
): number {
  const ordered = [...members].sort(
    (a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime(),
  );
  const host = ordered.find((m) => m.role === 'host');
  const vHostId = host?.id ?? ordered[0]!.id;
  const vMemberIds = staffManaged
    ? ordered.filter((m) => m.id !== vHostId).map((m) => m.id)
    : ordered.map((m) => m.id);
  const vFallback = staffManaged
    ? (vMemberIds[0] ?? vHostId)
    : (vMemberIds.includes(vHostId) ? vHostId : (vMemberIds[0] ?? vHostId));

  const resolveTarget = (pid: string | null | undefined): string => {
    if (pid && vMemberIds.includes(pid)) return pid;
    return vFallback;
  };

  let acc = 0;
  for (const it of items) {
    const tc = Math.max(0, it.tax_cents ?? 0);
    if (tc <= 0) continue;
    const mid = (it.assigned_payer_id ?? it.added_by_member_id) ?? vFallback;
    if (resolveTarget(mid) === forMemberId) acc += tc;
  }
  return acc;
}
