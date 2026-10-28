import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './config.ts';
import type { Db } from './db.ts';

/**
 * Seed EXCLUSIVAMENTE SINTÉTICO (schema ada_demo): duas unidades, equipes, efetivo,
 * treinamentos, OS com histórico e solicitações de compra. Determinístico (PRNG com semente).
 */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EQUIPES = [
  { id: 11, unit: 1, nome: 'Elétrica', gerencia: 'Gerência de Montagem', base: 42 },
  { id: 12, unit: 1, nome: 'Mecânica', gerencia: 'Gerência de Montagem', base: 35 },
  { id: 13, unit: 1, nome: 'Civil', gerencia: 'Gerência de Obras', base: 58 },
  { id: 14, unit: 1, nome: 'Andaimes', gerencia: 'Gerência de Obras', base: 22 },
  { id: 21, unit: 2, nome: 'Caldeiraria', gerencia: 'Gerência Industrial', base: 31 },
  { id: 22, unit: 2, nome: 'Pintura', gerencia: 'Gerência Industrial', base: 18 },
  { id: 23, unit: 2, nome: 'Isolamento', gerencia: 'Gerência de Manutenção', base: 24 }
];

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function seedDemo(db: Db, opts: { now?: Date; production?: boolean } = {}): Promise<void> {
  if (opts.production) throw new Error('Seed sintético é proibido em produção.');
  const now = opts.now ?? new Date();
  const rnd = prng(20261027);
  await db.exec(readFileSync(path.join(REPO_ROOT, 'db/demo/schema.sql'), 'utf8'));
  await db.query(`INSERT INTO ada_demo.unidade (id, nome) VALUES (1, 'Unidade Sintética Norte'), (2, 'Unidade Sintética Sul')`);
  for (const e of EQUIPES) await db.query(`INSERT INTO ada_demo.equipe (id, unit_id, nome, gerencia) VALUES ($1,$2,$3,$4)`, [e.id, e.unit, e.nome, e.gerencia]);

  // Efetivo diário: ~7 meses de dias úteis.
  const rows: unknown[][] = [];
  for (let i = 210; i >= 0; i--) {
    const dt = new Date(now.getTime() - i * 86_400_000);
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const e of EQUIPES) {
      const trend = 1 + (210 - i) / 900;
      const previsto = Math.round(e.base * trend);
      const presentes = Math.max(0, previsto - Math.floor(rnd() * previsto * 0.16));
      rows.push([e.unit, e.id, day(dt), presentes, previsto]);
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.map((_, j) => `($${j * 5 + 1},$${j * 5 + 2},$${j * 5 + 3}::date,$${j * 5 + 4},$${j * 5 + 5})`).join(',');
    await db.query(`INSERT INTO ada_demo.efetivo_diario (unit_id, equipe_id, data, presentes, previsto) VALUES ${values}`, chunk.flat());
  }

  const temas = ['NR-10', 'NR-35', 'NR-33', 'Integração', 'NR-12', 'Primeiros socorros', 'Ergonomia'];
  for (let i = 0; i < 320; i++) {
    const e = EQUIPES[Math.floor(rnd() * EQUIPES.length)]!;
    const dt = new Date(now.getTime() - Math.floor(rnd() * 200) * 86_400_000);
    await db.query(`INSERT INTO ada_demo.treinamento (unit_id, equipe_id, tema, status, data_conclusao) VALUES ($1,$2,$3,$4,$5)`, [
      e.unit, e.id, temas[Math.floor(rnd() * temas.length)], rnd() < 0.85 ? 'concluido' : 'pendente', day(dt)
    ]);
  }

  const statuses = ['aberta', 'em_execucao', 'aguardando_material', 'concluida', 'cancelada'] as const;
  const resp = ['Equipe Elétrica', 'Equipe Mecânica', 'Equipe Civil', 'Planejamento'];
  const insertOs = (id: number, unit: number, titulo: string, status: string, prazo: Date | null, created: Date, updated: Date, pct: number) =>
    db.query(
      `INSERT INTO ada_demo.os (os_id, unit_id, titulo, status, prazo_previsto, responsavel, percentual_concluido, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, unit, titulo, status, prazo, resp[id % resp.length], pct, created, updated]
    );
  // OS 123: caso principal da demonstração (unidade 1).
  await insertOs(123, 1, 'Substituição de painel elétrico — área de utilidades', 'em_execucao', new Date(now.getTime() + 3 * 86_400_000), new Date(now.getTime() - 20 * 86_400_000), new Date(now.getTime() - 10 * 3_600_000), 45);
  for (let i = 101; i <= 145; i++) {
    if (i === 123) continue;
    const created = new Date(now.getTime() - Math.floor(rnd() * 180) * 86_400_000);
    const st = statuses[Math.floor(rnd() * statuses.length)]!;
    await insertOs(i, 1, `OS sintética ${i}`, st, new Date(created.getTime() + Math.floor(5 + rnd() * 40) * 86_400_000), created, new Date(created.getTime() + Math.floor(rnd() * 5) * 86_400_000), st === 'concluida' ? 100 : Math.floor(rnd() * 90));
  }
  for (let i = 201; i <= 230; i++) {
    const created = new Date(now.getTime() - Math.floor(rnd() * 180) * 86_400_000);
    const st = statuses[Math.floor(rnd() * statuses.length)]!;
    await insertOs(i, 2, `OS sintética ${i}`, st, new Date(created.getTime() + Math.floor(5 + rnd() * 40) * 86_400_000), created, new Date(created.getTime() + Math.floor(rnd() * 5) * 86_400_000), st === 'concluida' ? 100 : Math.floor(rnd() * 90));
  }

  const cats = ['Materiais elétricos', 'EPI', 'Ferramentas', 'Serviços', 'Andaimes'];
  const sst = ['aberta', 'em_cotacao', 'aprovada', 'recebida', 'cancelada'];
  for (let i = 0; i < 420; i++) {
    const unit = rnd() < 0.6 ? 1 : 2;
    await db.query(`INSERT INTO ada_demo.solicitacao_compra (unit_id, data, status, categoria, valor) VALUES ($1,$2,$3,$4,$5)`, [
      unit, day(new Date(now.getTime() - Math.floor(rnd() * 200) * 86_400_000)), sst[Math.floor(rnd() * sst.length)], cats[Math.floor(rnd() * cats.length)], (200 + rnd() * 18000).toFixed(2)
    ]);
  }
}
