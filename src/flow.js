
// ---------- flow (stages computed from section_deps; read-only) ----------
// stage = 1 for sections with no active prerequisites, otherwise 1 + longest chain of prerequisites (handles diamonds; cycles are ignored defensively)
function computeFlow(sections, edges) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const prereqs = new Map(sections.map((s) => [s.id, []]));
  const dependents = new Map(sections.map((s) => [s.id, []]));
  for (const e of edges) {
    if (!byId.has(e.section_id) || !byId.has(e.depends_on_section_id) || e.section_id === e.depends_on_section_id) continue;
    prereqs.get(e.section_id).push({ id: e.depends_on_section_id, type: e.dependency_type });
    dependents.get(e.depends_on_section_id).push(e.section_id);
  }
  const memo = new Map(), visiting = new Set();
  const stageOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 1;
    visiting.add(id);
    let st = 1;
    for (const p of prereqs.get(id)) st = Math.max(st, 1 + stageOf(p.id));
    visiting.delete(id);
    memo.set(id, st);
    return st;
  };
  const info = new Map();
  for (const sec of sections) {
    const pre = prereqs.get(sec.id);
    const pendingRequired = pre.filter((p) => p.type === 'mandatory' && byId.get(p.id).status !== 'done').map((p) => p.id);
    const pendingHelpful = pre.filter((p) => p.type === 'helpful' && byId.get(p.id).status !== 'done').map((p) => p.id);
    const state = sec.status === 'done' ? 'done' : pendingRequired.length ? 'waiting' : pendingHelpful.length ? 'draft' : 'ready';
    info.set(sec.id, { stage: stageOf(sec.id), state, prereqs: pre, dependents: dependents.get(sec.id), pendingRequired, pendingHelpful,
      linked: pre.length > 0 || dependents.get(sec.id).length > 0 });
  }
  return info;
}

module.exports = { computeFlow };
