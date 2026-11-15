#!/usr/bin/env node
// seafood-processing-for-claude-code: the one CLI. Claude Code slash commands
// call this; so can you.
//
//   node scripts/seafood.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a New Zealand seafood processor's record, kept the way a
// licensed fish receiver and RMP operator has to keep it: the fishers and
// vessels landing to it, every landing (one vessel, one species, one day: the
// raw lot), the processing runs and their yields, the cases that come off the
// line with their real net weight, the chillers and freezers, the orders and
// dispatches, and the fisher settlements.
//
// The sharp edges are deliberate. A landing from a fisher with no current
// permit, or fish received above the species' receiving limit, is held, not
// received. Bivalve shellfish without a harvest area clearance cannot go on
// the line. A case from a scombroid lot (tuna, kingfish) cannot dispatch
// without a histamine result, and never above 200 mg/kg. An export order
// cannot dispatch without its E-cert reference, and there is no force flag.
// Nothing here connects to MPI, FishServe or a customer, and nothing sends.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, isoDate, short, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'export', 'hold']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const money = (v) => (num(v) < 0 ? '-' : '') + '$' + Math.abs(num(v)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const kg = (v) => `${num(v).toFixed(1).replace(/\.0$/, '')} kg`;
const HISTAMINE_LIMIT = 200; // mg/kg, Food Standards Code Schedule 19

function need(flags, name, what) {
  const v = str(flags[name]);
  if (!v) throw new CliError(`Missing --${name}${what ? ` (${what})` : ''}.`);
  return v;
}

function positive(v, what) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new CliError(`${what} must be a number above zero ("${v}").`);
  return n;
}

// ---------------------------------------------------------------------------
// Dates

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand writes DD/MM/YYYY.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// Lookups: id prefix, exact ref or name, then contains. One hit wins; several
// list the candidates and exit 1.

const RESOLVERS = {
  fisher: {
    from: 'fishers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.code, '')) = lower($1) or lower(coalesce(c.permit_no, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.code ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name} (${r.code || 'no code'}, ${r.status})`,
    order: 'c.name',
    listing: 'fishers --all',
  },
  vessel: {
    from: 'vessels c join fishers f on f.id = c.fisher_id',
    cols: 'c.*, f.name as fisher_name, f.permit_no, f.permit_expires_on',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.registration, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.registration ilike $1 or f.name ilike $1',
    label: (r) => `${r.name} (${r.registration || 'no registration'}, ${r.method}, ${r.fisher_name})`,
    order: 'c.name',
    listing: 'vessels',
  },
  species: {
    from: 'species c',
    cols: 'c.*',
    exact: 'lower(c.code) = lower($1) or lower(c.name) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.code ilike $1',
    label: (r) => `${r.name} (${r.code})`,
    order: 'c.name',
    listing: 'species',
  },
  product: {
    from: 'products c join species s on s.id = c.species_id',
    cols: 'c.*, s.code as species_code, s.chilled_shelf_days, s.scombroid',
    exact: 'lower(c.code) = lower($1) or lower(c.name) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.code ilike $1',
    label: (r) => `${r.code}  ${r.name} (${r.storage})`,
    order: 'c.code',
    listing: 'products',
  },
  landing: {
    from: 'landings c join vessels v on v.id = c.vessel_id',
    cols: 'c.*, v.name as vessel_name',
    exact: "lower(c.ref) = lower($1) or lower(c.ref) = lower('LND-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or v.name ilike $1 or c.trip_ref ilike $1',
    label: (r) => `${r.ref}  ${r.vessel_name}, landed ${isoDate(r.landed_on)} (${r.status})`,
    order: 'c.landed_on desc',
    listing: 'landings --all',
  },
  run: {
    from: 'runs c',
    cols: 'c.*',
    exact: "lower(c.ref) = lower($1) or lower(c.ref) = lower('RUN-' || $1)",
    fuzzy: 'c.ref ilike $1',
    label: (r) => `${r.ref}  ${isoDate(r.run_on)}`,
    order: 'c.run_on desc',
    listing: 'runs',
  },
  case: {
    from: 'cases c',
    cols: 'c.*',
    exact: "lower(c.case_no) = lower($1) or lower(c.case_no) = lower('CS-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.case_no ilike $1',
    label: (r) => `${r.case_no}  ${r.net_kg} kg (${r.status})`,
    order: 'c.case_no',
    listing: 'cases --all',
  },
  customer: {
    from: 'customers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name} (${r.country})`,
    order: 'c.name',
    listing: 'customers',
  },
  order: {
    from: 'orders c join customers cu on cu.id = c.customer_id',
    cols: 'c.*, cu.name as customer_name',
    exact: "lower(c.ref) = lower($1) or lower(c.ref) = lower('ORD-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or cu.name ilike $1',
    label: (r) => `${r.ref}  ${r.customer_name} (${r.status})`,
    order: 'c.created_on desc',
    listing: 'orders --all',
  },
  settlement: {
    from: 'settlements c join fishers f on f.id = c.fisher_id',
    cols: 'c.*, f.name as fisher_name',
    exact: "lower(c.ref) = lower($1) or lower(c.ref) = lower('SET-' || $1)",
    fuzzy: 'c.ref ilike $1 or f.name ilike $1',
    label: (r) => `${r.ref}  ${r.fisher_name} to ${isoDate(r.period_to)} (${r.status})`,
    order: 'c.period_to desc',
    listing: 'settlements',
  },
  room: {
    from: 'coolrooms c',
    cols: 'c.*',
    exact: 'lower(c.name) = lower($1)',
    fuzzy: 'c.name ilike $1',
    label: (r) => `${r.name} (${r.target_min_c} to ${r.target_max_c} C)`,
    order: 'c.name',
    listing: 'coolstore',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, reference or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
    rows = [];
  }
  rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a reference, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

async function nextRef(db, prefix, tableName, column, start) {
  const [r] = await db.query(
    `select coalesce(max(substring(${column} from ${prefix.length + 2})::int), ${start}) + 1 as n from ${tableName} where ${column} ~ '^${prefix}-[0-9]+$'`,
  );
  return `${prefix}-${r.n}`;
}

async function note(db, kind, id, label, body) {
  await db.query('insert into notes (target_kind, target_id, target_label, body) values ($1, $2, $3, $4)', [kind, id, label, body]);
}

// ---------------------------------------------------------------------------
// Column sets

const LANDING_COLS = [
  { key: 'ref', label: 'lot' },
  { key: 'landed_on', label: 'landed', format: (v) => isoDate(v) },
  { key: 'vessel', label: 'vessel', width: 16 },
  { key: 'fisher', label: 'fisher', width: 22 },
  { key: 'species', label: 'species', width: 14 },
  { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(0) },
  { key: 'receive_temp_c', label: 'temp', align: 'right', format: (v, r) => (v === null ? '-' : `${num(v)}${r.temp_breach ? '!' : ''}`) },
  { key: 'checks', label: 'checks', format: (v, r) => landingChecks(r) },
  { key: 'status', label: 'status', format: (v) => (v === 'held' ? 'HELD' : v) },
];

function landingChecks(r) {
  const out = [];
  if (r.bivalve) out.push(r.shellfish_clearance_ref ? 'cleared' : 'NO CLEARANCE');
  if (r.scombroid) out.push(r.histamine_mg_kg === null ? 'histamine untested' : num(r.histamine_mg_kg) > HISTAMINE_LIMIT ? `HISTAMINE ${num(r.histamine_mg_kg)}` : `histamine ${num(r.histamine_mg_kg)}`);
  if (r.permit_lapsed_at_landing) out.push('PERMIT LAPSED');
  return out.join(', ');
}

const CASE_COLS = [
  { key: 'case_no', label: 'case' },
  { key: 'product_code', label: 'product' },
  { key: 'net_kg', label: 'net kg', align: 'right', format: (v) => num(v).toFixed(2) },
  { key: 'landing_ref', label: 'lot' },
  { key: 'vessel', label: 'vessel', width: 14 },
  { key: 'packed_on', label: 'packed', format: (v) => isoDate(v) },
  { key: 'use_by', label: 'use by', format: (v, r) => `${isoDate(v)}${r.status === 'in_store' && num(r.days_to_use_by) < 0 ? ' PASSED' : ''}` },
  { key: 'room', label: 'room', format: (v) => v || '' },
  { key: 'order_ref', label: 'order', format: (v) => v || '' },
  { key: 'status', label: 'status' },
];

const ORDER_COLS = [
  { key: 'ref', label: 'order' },
  { key: 'customer', label: 'customer', width: 26 },
  { key: 'export', label: 'type', format: (v, r) => (v ? `EXPORT ${r.destination || ''}`.trim() : 'domestic') },
  { key: 'required_on', label: 'required', format: (v) => isoDate(v) },
  { key: 'kg_ordered', label: 'ordered', align: 'right', format: (v) => num(v).toFixed(0) },
  { key: 'kg_allocated', label: 'allocated', align: 'right', format: (v) => num(v).toFixed(1) },
  { key: 'ecert_ref', label: 'E-cert', format: (v, r) => (r.export ? v || 'MISSING' : '') },
  { key: 'invoice_value', label: 'value', align: 'right', format: (v) => money(v) },
  { key: 'status', label: 'status' },
];

// ---------------------------------------------------------------------------
// Reads

async function cmdFishers(db, args, flags) {
  const rows = await db.query(
    `select * from v_fishers ${flags.all ? '' : "where status = 'active'"}
     order by case permit when 'EXPIRED' then 1 when 'NONE' then 2 when 'expiring' then 3 else 4 end, name`,
  );
  return {
    json: rows,
    text:
      heading('Fishers and their permits') +
      '\n' +
      table(rows, [
        { key: 'code', label: 'code' },
        { key: 'name', label: 'fisher', width: 28 },
        { key: 'permit_no', label: 'permit', format: (v) => v || '' },
        { key: 'permit_expires_on', label: 'expires', format: (v) => isoDate(v) },
        { key: 'permit', label: 'state' },
        { key: 'vessels', label: 'vessels', align: 'right' },
        { key: 'kg_30d', label: 'kg 30d', align: 'right', format: (v) => num(v).toFixed(0) },
        { key: 'owed_unsettled', label: 'owed', align: 'right', format: (v) => money(v) },
      ]) +
      '\nA licensed fish receiver buys only from a current permit holder. An expired permit holds the landing at the door.',
  };
}

async function cmdFisher(db, args) {
  const f = await resolve(db, 'fisher', args.join(' '));
  const [fisher] = await db.query('select * from v_fishers where fisher_id = $1', [f.id]);
  const vessels = await db.query('select name, registration, method, home_port, status from vessels where fisher_id = $1 order by name', [f.id]);
  const landings = await db.query('select * from v_landings where fisher_id = $1 order by landed_on desc limit 20', [f.id]);
  const yields = await db.query('select ref, landing_ref, species, run_on, input_kg, output_kg, yield_pct, standard_yield_pct, yield_gap from v_runs where landing_id in (select landing_id from v_landings where fisher_id = $1) order by run_on desc', [f.id]);
  const unsettled = await db.query('select * from v_settlement_lines where fisher_id = $1 and settlement_id is null and status in ($2, $3) order by landed_on', [f.id, 'received', 'processed']);
  const settlements = await db.query('select ref, period_to, status, paid_on, landings, kg, gross, deductions, net from v_settlements where fisher_id = $1 order by period_to desc', [f.id]);
  const notes = await db.query("select noted_at, target_label, body from notes where (target_kind = 'fisher' and target_id = $1) or target_id in (select id from landings where vessel_id in (select id from vessels where fisher_id = $1)) order by noted_at desc limit 10", [f.id]);
  let text = heading(`${fisher.name} (${fisher.code || 'no code'})`);
  text += `\n  Contact: ${fisher.contact_name || '-'}  ${fisher.phone || ''}`;
  text += `\n  Permit:  ${fisher.permit_no || 'NONE'}  expires ${isoDate(fisher.permit_expires_on) || '-'}  (${fisher.permit})`;
  text += `\n  Deduction: ${money(fisher.deduction_per_kg)} per kg   Owed, not yet settled: ${money(fisher.owed_unsettled)}`;
  text += '\n\nVessels\n' + table(vessels, [{ key: 'name', label: 'vessel' }, { key: 'registration', label: 'registration' }, { key: 'method', label: 'method' }, { key: 'home_port', label: 'port' }, { key: 'status', label: 'status' }]);
  text += '\n\nLandings\n' + table(landings, LANDING_COLS.filter((c) => c.key !== 'fisher'));
  text += '\n\nYields from their fish\n' + table(yields, [{ key: 'ref', label: 'run' }, { key: 'landing_ref', label: 'lot' }, { key: 'species', label: 'species' }, { key: 'run_on', label: 'run', format: (v) => isoDate(v) }, { key: 'yield_pct', label: 'yield', align: 'right', format: (v) => `${num(v)}%` }, { key: 'standard_yield_pct', label: 'standard', align: 'right', format: (v) => (v === null ? '' : `${num(v)}%`) }]);
  text += '\n\nNot yet settled\n' + table(unsettled, [{ key: 'ref', label: 'lot' }, { key: 'landed_on', label: 'landed', format: (v) => isoDate(v) }, { key: 'species', label: 'species' }, { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(0) }, { key: 'price_per_kg', label: '$/kg', align: 'right', format: (v) => (v === null ? 'NO PRICE' : money(v)) }, { key: 'net', label: 'net', align: 'right', format: (v) => money(v) }]);
  text += '\n\nSettlements\n' + table(settlements, [{ key: 'ref', label: 'ref' }, { key: 'period_to', label: 'to', format: (v) => isoDate(v) }, { key: 'landings', label: 'lots', align: 'right' }, { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(0) }, { key: 'net', label: 'net', align: 'right', format: (v) => money(v) }, { key: 'status', label: 'status' }]);
  if (notes.length) text += '\n\nThe file\n' + notes.map((n) => `  ${isoDate(n.noted_at)}  ${n.target_label}: ${n.body}`).join('\n');
  return { json: { fisher, vessels, landings, yields, unsettled, settlements, notes }, text };
}

async function cmdVessels(db) {
  const rows = await db.query(
    `select v.name, v.registration, v.method, v.home_port, f.name as fisher, f.permit_no, v.status,
            (select max(l.landed_on) from landings l where l.vessel_id = v.id) as last_landing
     from vessels v join fishers f on f.id = v.fisher_id order by v.status, v.name`,
  );
  return { json: rows, text: heading('Vessels') + '\n' + table(rows, [{ key: 'name', label: 'vessel' }, { key: 'registration', label: 'registration' }, { key: 'method', label: 'method' }, { key: 'home_port', label: 'port' }, { key: 'fisher', label: 'fisher', width: 26 }, { key: 'last_landing', label: 'last landing', format: (v) => isoDate(v) }, { key: 'status', label: 'status' }]) };
}

async function cmdSpecies(db) {
  const rows = await db.query('select code, name, kind, scombroid, bivalve, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg from species order by name');
  return {
    json: rows,
    text:
      heading('Species') +
      '\n' +
      table(rows, [
        { key: 'code', label: 'code' },
        { key: 'name', label: 'species' },
        { key: 'kind', label: 'kind' },
        { key: 'flags', label: 'controls', format: (v, r) => [r.scombroid ? 'scombroid: histamine' : '', r.bivalve ? 'bivalve: area clearance' : ''].filter(Boolean).join(', ') },
        { key: 'receive_max_c', label: 'receive max', align: 'right', format: (v) => `${num(v)} C` },
        { key: 'standard_yield_pct', label: 'yield std', align: 'right', format: (v) => (v === null ? '' : `${num(v)}%`) },
        { key: 'chilled_shelf_days', label: 'shelf days', align: 'right' },
        { key: 'price_per_kg', label: 'beach $/kg', align: 'right', format: (v) => (v === null ? '' : money(v)) },
      ]),
  };
}

async function cmdProducts(db) {
  const rows = await db.query(
    `select p.code, p.name, s.code as species, p.form, p.storage, p.nominal_case_kg, p.allergen_statement, p.origin_statement, p.status,
            (select count(*) from cases c where c.product_id = p.id and c.status = 'in_store') as in_store
     from products p join species s on s.id = p.species_id order by p.status, p.code`,
  );
  return {
    json: rows,
    text:
      heading('Product specifications') +
      '\n' +
      table(rows, [
        { key: 'code', label: 'code' },
        { key: 'name', label: 'product', width: 32 },
        { key: 'storage', label: 'storage' },
        { key: 'allergen_statement', label: 'allergen statement', format: (v) => v || 'MISSING' },
        { key: 'origin_statement', label: 'origin', format: (v) => v || 'MISSING' },
        { key: 'in_store', label: 'in store', align: 'right' },
      ]),
  };
}

async function cmdLandings(db, args, flags) {
  const where = [];
  const params = [];
  if (!flags.all && !flags.status) where.push("status in ('received', 'held')");
  if (flags.status) {
    params.push(str(flags.status));
    where.push(`status = $${params.length}`);
  }
  if (flags.fisher) {
    const f = await resolve(db, 'fisher', flags.fisher);
    params.push(f.id);
    where.push(`fisher_id = $${params.length}`);
  }
  if (flags.species) {
    const s = await resolve(db, 'species', flags.species);
    params.push(s.id);
    where.push(`species_id = $${params.length}`);
  }
  const rows = await db.query(`select * from v_landings ${where.length ? 'where ' + where.join(' and ') : ''} order by case status when 'held' then 0 else 1 end, landed_on desc, ref desc`, params);
  return { json: rows, text: heading(flags.all ? 'Every landing' : 'Landings on the floor') + '\n' + table(rows, LANDING_COLS) };
}

async function cmdLanding(db, args) {
  const l = await resolve(db, 'landing', args.join(' '));
  const [landing] = await db.query('select * from v_landings where landing_id = $1', [l.id]);
  const runs = await db.query('select ref, run_on, input_kg, output_kg, cases, yield_pct, standard_yield_pct from v_runs where landing_id = $1 order by run_on', [l.id]);
  const cases = await db.query('select product_code, status, count(*) as cases, sum(net_kg) as kg, min(use_by) as use_by, string_agg(distinct coalesce(order_ref, \'\'), \' \') as orders from v_cases where landing_id = $1 group by product_code, status order by product_code, status', [l.id]);
  const notes = await db.query("select noted_at, body from notes where target_id = $1 order by noted_at desc", [l.id]);
  let text = heading(`${landing.ref}: ${landing.species}, ${kg(landing.kg)} off ${landing.vessel}`);
  text += `\n  Fisher:   ${landing.fisher}  permit ${landing.permit_no || 'NONE'}${landing.permit_lapsed_at_landing ? ' (LAPSED at landing)' : ''}`;
  text += `\n  Landed:   ${isoDate(landing.landed_on)}  trip ${landing.trip_ref || '-'}  area ${landing.stat_area || '-'}  landing report ${landing.landing_report_ref || 'MISSING'}`;
  text += `\n  Received: ${landing.receive_temp_c === null ? 'no temperature recorded' : `${num(landing.receive_temp_c)} C`} against a limit of ${num(landing.receive_max_c)} C${landing.temp_breach ? '  BREACH' : ''}`;
  if (landing.bivalve) text += `\n  Harvest area clearance: ${landing.shellfish_clearance_ref || 'NONE ON RECORD: cannot be processed'}`;
  if (landing.scombroid) text += `\n  Histamine: ${landing.histamine_mg_kg === null ? 'NOT TESTED: no case from this lot can dispatch' : `${num(landing.histamine_mg_kg)} mg/kg on ${isoDate(landing.histamine_tested_on)}${num(landing.histamine_mg_kg) > HISTAMINE_LIMIT ? '  OVER THE 200 mg/kg LIMIT' : ''}`}`;
  text += `\n  Price:    ${landing.price_per_kg === null ? 'none agreed' : `${money(landing.price_per_kg)}/kg${landing.price_agreed ? '' : ' (beach price for the species)'}`}   Status: ${landing.status.toUpperCase()}${landing.hold_reason ? `\n  Held:     ${landing.hold_reason}` : ''}`;
  text += '\n\nRuns\n' + table(runs, [{ key: 'ref', label: 'run' }, { key: 'run_on', label: 'on', format: (v) => isoDate(v) }, { key: 'input_kg', label: 'in kg', align: 'right', format: (v) => num(v).toFixed(0) }, { key: 'output_kg', label: 'out kg', align: 'right', format: (v) => num(v).toFixed(1) }, { key: 'cases', label: 'cases', align: 'right' }, { key: 'yield_pct', label: 'yield', align: 'right', format: (v) => `${num(v)}%` }]);
  text += '\n\nWhere it went\n' + table(cases, [{ key: 'product_code', label: 'product' }, { key: 'status', label: 'status' }, { key: 'cases', label: 'cases', align: 'right' }, { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(1) }, { key: 'orders', label: 'orders' }]);
  if (notes.length) text += '\n\nThe decision trail\n' + notes.map((n) => `  ${isoDate(n.noted_at)}  ${n.body}`).join('\n');
  return { json: { landing, runs, cases, notes }, text };
}

async function cmdRuns(db, args, flags) {
  const days = Number(flags.days || 30);
  const rows = await db.query('select * from v_runs where run_on > current_date - $1::int order by run_on desc, ref desc', [days]);
  const bySpecies = await db.query(
    `select species, count(*) as runs, sum(input_kg) as input_kg, sum(output_kg) as output_kg,
            round(100.0 * sum(output_kg) / sum(input_kg), 1) as yield_pct, max(standard_yield_pct) as standard_yield_pct
     from v_runs where run_on > current_date - $1::int group by species order by species`,
    [days],
  );
  return {
    json: { runs: rows, by_species: bySpecies },
    text:
      heading(`Processing runs and yields, last ${days} days`) +
      '\n' +
      table(rows, [
        { key: 'ref', label: 'run' },
        { key: 'run_on', label: 'on', format: (v) => isoDate(v) },
        { key: 'landing_ref', label: 'lot' },
        { key: 'species', label: 'species', width: 14 },
        { key: 'vessel', label: 'vessel', width: 14 },
        { key: 'input_kg', label: 'in kg', align: 'right', format: (v) => num(v).toFixed(0) },
        { key: 'output_kg', label: 'out kg', align: 'right', format: (v) => num(v).toFixed(1) },
        { key: 'yield_pct', label: 'yield', align: 'right', format: (v) => `${num(v)}%` },
        { key: 'standard_yield_pct', label: 'std', align: 'right', format: (v) => (v === null ? '' : `${num(v)}%`) },
        { key: 'yield_gap', label: 'gap', align: 'right', format: (v, r) => (r.standard_yield_pct === null ? '' : `${num(v) > 0 ? '+' : ''}${num(v)}${num(v) <= -5 ? ' LOW' : ''}`) },
      ]) +
      '\n\nBy species\n' +
      table(bySpecies, [
        { key: 'species', label: 'species' },
        { key: 'runs', label: 'runs', align: 'right' },
        { key: 'input_kg', label: 'in kg', align: 'right', format: (v) => num(v).toFixed(0) },
        { key: 'output_kg', label: 'out kg', align: 'right', format: (v) => num(v).toFixed(1) },
        { key: 'yield_pct', label: 'yield', align: 'right', format: (v) => `${num(v)}%` },
        { key: 'standard_yield_pct', label: 'std', align: 'right', format: (v) => (v === null ? '' : `${num(v)}%`) },
      ]) +
      '\nEvery point of yield on a fillet line is money: at a 42% standard, one point on 820 kg of snapper is 8.2 kg of fillet.',
  };
}

async function cmdCases(db, args, flags) {
  const where = [];
  const params = [];
  if (!flags.all) where.push("status = 'in_store'");
  if (flags.room) {
    params.push(str(flags.room));
    where.push(`lower(room) = lower($${params.length})`);
  }
  if (flags.product) {
    const p = await resolve(db, 'product', flags.product);
    params.push(p.id);
    where.push(`product_id = $${params.length}`);
  }
  if (flags.order) {
    const o = await resolve(db, 'order', flags.order);
    params.push(o.id);
    where.push(`order_id = $${params.length}`);
  }
  if (flags.unallocated) where.push('order_id is null');
  const rows = await db.query(`select * from v_cases ${where.length ? 'where ' + where.join(' and ') : ''} order by use_by, case_no`, params);
  const total = rows.reduce((a, r) => a + num(r.net_kg), 0);
  return { json: rows, text: heading(flags.all ? 'Every case' : 'Cases in store, nearest use-by first') + '\n' + table(rows, CASE_COLS) + `\n  ${rows.length} cases, ${total.toFixed(1)} kg net.` };
}

async function cmdStore(db) {
  const rows = await db.query(
    `select product_code, product, storage, count(*) as cases, sum(net_kg) as kg,
            count(*) filter (where order_id is null) as unallocated, min(use_by) as first_use_by,
            string_agg(distinct coalesce(room, ''), ', ') as rooms
     from v_cases where status = 'in_store' group by product_code, product, storage order by storage, product_code`,
  );
  return {
    json: rows,
    text:
      heading('Stock on hand by product') +
      '\n' +
      table(rows, [
        { key: 'product_code', label: 'product' },
        { key: 'storage', label: 'storage' },
        { key: 'cases', label: 'cases', align: 'right' },
        { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(1) },
        { key: 'unallocated', label: 'free', align: 'right' },
        { key: 'first_use_by', label: 'first use-by', format: (v) => isoDate(v) },
        { key: 'rooms', label: 'rooms' },
      ]),
  };
}

async function cmdTrace(db, args) {
  const q = args.join(' ');
  let c = null;
  if (/^(cs-)?\d{5,}$/i.test(q.trim()) || /^cs-/i.test(q.trim())) c = await resolve(db, 'case', q, { optional: true });
  if (!c && !/^(lnd-|run-)/i.test(q.trim())) c = await resolve(db, 'case', q, { optional: true });
  let landingId;
  let theCase = null;
  if (c) {
    [theCase] = await db.query('select * from v_cases where case_id = $1', [c.id]);
    landingId = theCase.landing_id;
  } else {
    const l = await resolve(db, 'landing', q);
    landingId = l.id;
  }
  const [landing] = await db.query('select * from v_landings where landing_id = $1', [landingId]);
  const forward = await db.query(
    `select coalesce(o.ref, '(in store)') as order_ref, coalesce(cu.name, '') as customer, coalesce(o.destination, '') as destination,
            coalesce(o.ecert_ref, '') as ecert, c.status, count(*) as cases, sum(c.net_kg) as kg, max(o.dispatched_on) as dispatched_on
     from cases c join runs r on r.id = c.run_id left join orders o on o.id = c.order_id left join customers cu on cu.id = o.customer_id
     where r.landing_id = $1 group by o.ref, cu.name, o.destination, o.ecert_ref, c.status order by o.ref nulls last`,
    [landingId],
  );
  let text = heading(theCase ? `Trace ${theCase.case_no}` : `Trace lot ${landing.ref}`);
  if (theCase) text += `\n  This case: ${theCase.product} ${num(theCase.net_kg).toFixed(2)} kg, packed ${isoDate(theCase.packed_on)} on ${theCase.run_ref}, ${theCase.status}${theCase.order_ref ? ` on ${theCase.order_ref}` : ''}`;
  text += '\n\nOne step back';
  text += `\n  Lot ${landing.ref}: ${landing.species}, ${kg(landing.kg)}, landed ${isoDate(landing.landed_on)}`;
  text += `\n  Vessel ${landing.vessel} (${landing.method}), fisher ${landing.fisher}, permit ${landing.permit_no || 'NONE'}`;
  text += `\n  Trip ${landing.trip_ref || '-'}, area ${landing.stat_area || '-'}, landing report ${landing.landing_report_ref || 'MISSING'}`;
  text += `\n  Received at ${landing.receive_temp_c === null ? '?' : num(landing.receive_temp_c)} C${landing.scombroid ? `, histamine ${landing.histamine_mg_kg === null ? 'not tested' : num(landing.histamine_mg_kg) + ' mg/kg'}` : ''}${landing.bivalve ? `, clearance ${landing.shellfish_clearance_ref || 'NONE'}` : ''}`;
  text += '\n\nOne step forward: every case from this lot\n' + table(forward, [{ key: 'order_ref', label: 'order' }, { key: 'customer', label: 'customer', width: 26 }, { key: 'destination', label: 'destination' }, { key: 'ecert', label: 'E-cert' }, { key: 'status', label: 'status' }, { key: 'cases', label: 'cases', align: 'right' }, { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(1) }]);
  text += '\n\nIf this lot came back in a recall, the table above is the list of who to ring.';
  return { json: { case: theCase, landing, forward }, text };
}

async function cmdOrders(db, args, flags) {
  const rows = await db.query(`select * from v_orders ${flags.all ? '' : "where status = 'open'"} order by case status when 'open' then 0 else 1 end, required_on nulls last`);
  return { json: rows, text: heading(flags.all ? 'Every order' : 'Open orders') + '\n' + table(rows, ORDER_COLS) };
}

async function cmdOrder(db, args) {
  const o = await resolve(db, 'order', args.join(' '));
  const [order] = await db.query('select * from v_orders where order_id = $1', [o.id]);
  const lines = await db.query(
    `select p.code as product, p.name, ol.kg_ordered, ol.price_per_kg,
            coalesce((select sum(c.net_kg) from cases c where c.order_id = ol.order_id and c.product_id = ol.product_id), 0) as kg_allocated
     from order_lines ol join products p on p.id = ol.product_id where ol.order_id = $1 order by p.code`,
    [o.id],
  );
  const cases = await db.query('select * from v_cases where order_id = $1 order by case_no', [o.id]);
  const blockers = dispatchBlockers(order, cases);
  let text = heading(`${order.ref}: ${order.customer}`);
  text += `\n  ${order.export ? `EXPORT to ${order.destination || '?'}` : `Domestic, ${order.destination || ''}`}   required ${isoDate(order.required_on) || '-'}   carrier ${order.carrier || '-'}   status ${order.status}`;
  if (order.export) text += `\n  E-cert: ${order.ecert_ref || 'NOT ON RECORD: this order cannot leave'}`;
  text += '\n\nLines\n' + table(lines, [{ key: 'product', label: 'product' }, { key: 'name', label: 'description', width: 30 }, { key: 'kg_ordered', label: 'ordered', align: 'right', format: (v) => num(v).toFixed(0) }, { key: 'kg_allocated', label: 'allocated', align: 'right', format: (v) => num(v).toFixed(1) }, { key: 'price_per_kg', label: '$/kg', align: 'right', format: (v) => money(v) }]);
  text += `\n\nCases (${cases.length}, ${order.kg_allocated} kg net, invoice at catch weight ${money(order.invoice_value)})\n` + table(cases.slice(0, 30), CASE_COLS.filter((c) => c.key !== 'order_ref'));
  if (cases.length > 30) text += `\n  ... and ${cases.length - 30} more (cases --order=${order.ref})`;
  if (order.status === 'open') text += blockers.length ? `\n\nCannot dispatch yet:\n${blockers.map((b) => `  - ${b}`).join('\n')}` : '\n\nClear to dispatch.';
  return { json: { order, lines, cases, blockers }, text };
}

function dispatchBlockers(order, cases) {
  const out = [];
  if (!cases.length) out.push('no cases allocated');
  if (order.export && !order.ecert_ref) out.push('export order with no E-cert reference (ecert <order> --ref=)');
  const untested = cases.filter((c) => c.scombroid && c.histamine_mg_kg === null);
  if (untested.length) out.push(`${untested.length} cases from scombroid lots with no histamine result (${[...new Set(untested.map((c) => c.landing_ref))].join(', ')})`);
  const over = cases.filter((c) => c.scombroid && num(c.histamine_mg_kg) > HISTAMINE_LIMIT);
  if (over.length) out.push(`${over.length} cases from a lot over the 200 mg/kg histamine limit`);
  const passed = cases.filter((c) => c.status === 'in_store' && num(c.days_to_use_by) < 0);
  if (passed.length) out.push(`${passed.length} cases past their use-by`);
  return out;
}

async function cmdCoolstore(db) {
  const rows = await db.query("select * from v_coolstore order by case state when 'OUT OF RANGE' then 1 when 'NEVER CHECKED' then 2 when 'QUIET' then 3 else 4 end, room");
  return {
    json: rows,
    text:
      heading('The cold store') +
      '\n' +
      table(rows, [
        { key: 'room', label: 'room' },
        { key: 'kind', label: 'kind' },
        { key: 'band', label: 'band', format: (v, r) => `${num(r.target_min_c)} to ${num(r.target_max_c)} C` },
        { key: 'last_temp_c', label: 'last', align: 'right', format: (v) => (v === null ? '-' : `${num(v)} C`) },
        { key: 'hours_since', label: 'checked', format: (v) => (v === null ? 'NEVER' : `${Math.round(num(v))}h ago`) },
        { key: 'checked_by', label: 'by', format: (v) => v || '' },
        { key: 'cases_in_room', label: 'cases', align: 'right' },
        { key: 'state', label: 'state' },
      ]) +
      '\nThe temperature record is what the RMP verifier reads. A quiet room is a gap in it.',
  };
}

async function cmdSettlements(db) {
  const rows = await db.query('select * from v_settlements order by period_to desc, ref desc');
  const owed = await db.query("select name, code, owed_unsettled from v_fishers where owed_unsettled > 0 order by owed_unsettled desc");
  return {
    json: { settlements: rows, owed },
    text:
      heading('Fisher settlements') +
      '\n' +
      table(rows, [{ key: 'ref', label: 'ref' }, { key: 'fisher', label: 'fisher', width: 28 }, { key: 'period_to', label: 'to', format: (v) => isoDate(v) }, { key: 'landings', label: 'lots', align: 'right' }, { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(0) }, { key: 'gross', label: 'gross', align: 'right', format: (v) => money(v) }, { key: 'deductions', label: 'deductions', align: 'right', format: (v) => money(v) }, { key: 'net', label: 'net', align: 'right', format: (v) => money(v) }, { key: 'status', label: 'status' }]) +
      '\n\nOwed, not yet settled\n' +
      table(owed, [{ key: 'name', label: 'fisher', width: 28 }, { key: 'code', label: 'code' }, { key: 'owed_unsettled', label: 'owed', align: 'right', format: (v) => money(v) }]),
  };
}

async function cmdSettlement(db, args) {
  const s = await resolve(db, 'settlement', args.join(' '));
  const [settlement] = await db.query('select * from v_settlements where settlement_id = $1', [s.id]);
  const lines = await db.query('select * from v_settlement_lines where settlement_id = $1 order by landed_on, ref', [s.id]);
  const text =
    heading(`${settlement.ref}: ${settlement.fisher} to ${isoDate(settlement.period_to)} (${settlement.status})`) +
    '\n' +
    table(lines, [{ key: 'ref', label: 'lot' }, { key: 'landed_on', label: 'landed', format: (v) => isoDate(v) }, { key: 'vessel', label: 'vessel' }, { key: 'species', label: 'species' }, { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(1) }, { key: 'price_per_kg', label: '$/kg', align: 'right', format: (v) => money(v) }, { key: 'gross', label: 'gross', align: 'right', format: (v) => money(v) }, { key: 'deductions', label: 'deductions', align: 'right', format: (v) => money(v) }, { key: 'net', label: 'net', align: 'right', format: (v) => money(v) }]) +
    `\n\n  Gross ${money(settlement.gross)}, deductions ${money(settlement.deductions)}, net ${money(settlement.net)}.`;
  return { json: { settlement, lines }, text };
}

const ATTENTION_ORDER = ['landing_held', 'histamine_over', 'shellfish_no_clearance', 'histamine_missing', 'ecert_missing', 'coolstore_out_of_range', 'use_by_passed', 'permit_expired', 'order_late', 'landing_unprocessed', 'yield_low', 'use_by_close', 'landing_unpriced', 'coolstore_quiet', 'permit_expiring'];
const ATTENTION_LABEL = {
  landing_held: 'HELD at the door',
  histamine_over: 'HISTAMINE over the limit',
  shellfish_no_clearance: 'Shellfish with no area clearance',
  histamine_missing: 'No histamine result: cannot dispatch',
  ecert_missing: 'Export with no E-cert: cannot leave',
  coolstore_out_of_range: 'Cold store OUT OF RANGE',
  use_by_passed: 'Past use-by in store',
  permit_expired: 'Fisher permit EXPIRED',
  order_late: 'Order past its required date',
  landing_unprocessed: 'Fish waiting for the line',
  yield_low: 'Yield under standard',
  use_by_close: 'Use-by inside two days',
  landing_unpriced: 'No price: cannot settle',
  coolstore_quiet: 'Cold store check overdue',
  permit_expiring: 'Fisher permit expiring',
};

async function cmdAttention(db) {
  const rows = await db.query('select * from v_attention');
  rows.sort((a, b) => ATTENTION_ORDER.indexOf(a.reason) - ATTENTION_ORDER.indexOf(b.reason) || num(b.days) - num(a.days));
  const text =
    heading(`Needs a decision (${rows.length})`) +
    '\n' +
    table(rows, [
      { key: 'reason', label: 'what', format: (v) => ATTENTION_LABEL[v] || v },
      { key: 'label', label: 'record' },
      { key: 'who', label: 'who', width: 26 },
      { key: 'detail', label: 'detail', width: 90 },
    ]) +
    '\nWorst first: food safety and legal holds, then what blocks a dispatch, then condition and money.';
  return { json: rows, text };
}

async function cmdWeek(db) {
  const [landed] = await db.query("select count(*) as landings, coalesce(sum(kg), 0) as kg, count(*) filter (where status = 'held') as held from landings where landed_on > current_date - 7");
  const bySpecies = await db.query("select s.name as species, count(*) as landings, sum(l.kg) as kg from landings l join species s on s.id = l.species_id where l.landed_on > current_date - 7 group by s.name order by sum(l.kg) desc");
  const [line] = await db.query('select count(*) as runs, coalesce(sum(input_kg), 0) as input_kg, coalesce(sum(output_kg), 0) as output_kg from v_runs where run_on > current_date - 7');
  const [stock] = await db.query("select count(*) as cases, coalesce(sum(net_kg), 0) as kg, count(*) filter (where order_id is null) as unallocated from cases where status = 'in_store'");
  const [orders] = await db.query("select count(*) filter (where status = 'open') as open, count(*) filter (where status = 'open' and export) as export_open, coalesce(sum(invoice_value) filter (where status = 'dispatched' and dispatched_on > current_date - 7), 0) as dispatched_value from v_orders");
  const [owed] = await db.query('select coalesce(sum(owed_unsettled), 0) as owed from v_fishers');
  const [att] = await db.query('select count(*) as n from v_attention');
  const yieldPct = num(line.input_kg) ? ((100 * num(line.output_kg)) / num(line.input_kg)).toFixed(1) : '0';
  const json = { landed, by_species: bySpecies, line: { ...line, yield_pct: Number(yieldPct) }, stock, orders, owed_to_fishers: num(owed.owed), attention: num(att.n) };
  let text = heading('The last seven days');
  text += `\n  Landed:     ${landed.landings} landings, ${kg(landed.kg)}, ${landed.held} held at the door`;
  text += `\n  The line:   ${line.runs} runs, ${kg(line.input_kg)} in, ${kg(line.output_kg)} packed, ${yieldPct}% overall`;
  text += `\n  In store:   ${stock.cases} cases, ${kg(stock.kg)}, ${stock.unallocated} not on an order`;
  text += `\n  Orders:     ${orders.open} open (${orders.export_open} export), ${money(orders.dispatched_value)} dispatched this week at catch weight`;
  text += `\n  Fishers:    ${money(owed.owed)} owed for fish not yet settled`;
  text += `\n  Attention:  ${att.n} items (attention)`;
  text += '\n\nLanded by species\n' + table(bySpecies, [{ key: 'species', label: 'species' }, { key: 'landings', label: 'landings', align: 'right' }, { key: 'kg', label: 'kg', align: 'right', format: (v) => num(v).toFixed(0) }]);
  return { json, text };
}

async function cmdStats(db) {
  const tables = ['fishers', 'vessels', 'species', 'products', 'landings', 'runs', 'cases', 'customers', 'orders', 'order_lines', 'settlements', 'coolrooms', 'temp_checks', 'notes'];
  const out = {};
  for (const t of tables) out[t] = num((await db.query(`select count(*) as n from ${t}`))[0].n);
  return { json: out, text: heading('Records') + '\n' + Object.entries(out).map(([k, v]) => `  ${k.padEnd(12)} ${v}`).join('\n') };
}

// ---------------------------------------------------------------------------
// Writes: fish in

async function cmdLand(db, args, flags) {
  const v = await resolve(db, 'vessel', args.join(' '));
  if (v.status !== 'active') throw new CliError(`${v.name} is marked ${v.status}.`);
  const s = await resolve(db, 'species', need(flags, 'species', 'SNA, TAR, a species name'));
  const kgIn = positive(need(flags, 'kg', 'landed weight'), '--kg');
  const report = need(flags, 'report', "the fisher's landing report reference: no landing goes on the record without it");
  const landedOn = parseDate(flags.on) || today();
  const temp = flags.temp === undefined || flags.temp === true ? null : Number(flags.temp);
  if (temp === null) throw new CliError('Missing --temp: the receiving temperature is the first entry in the RMP record. Probe it and record it.');
  const holds = [];
  if (!v.permit_no) holds.push(`${v.fisher_name} has no fishing permit on record. A licensed fish receiver buys only from a permit holder.`);
  else if (v.permit_expires_on && isoDate(v.permit_expires_on) < landedOn) holds.push(`Fisher permit ${v.permit_no} expired ${isoDate(v.permit_expires_on)}. A licensed fish receiver buys only from a current permit holder.`);
  if (temp > num(s.receive_max_c)) holds.push(`Received at ${temp} C against the ${num(s.receive_max_c)} C receiving limit. Held for a QA decision: core temp recheck, sensory, or reject.`);
  if (flags.hold) holds.push(need(flags, 'reason', 'why it is held'));
  const ref = await nextRef(db, 'LND', 'landings', 'ref', 2100);
  const price = flags.price === undefined || flags.price === true ? null : Number(flags.price);
  const [row] = await db.query(
    `insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, shellfish_clearance_ref, price_per_kg, status, hold_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
    [ref, v.id, s.id, landedOn, str(flags.trip) || null, report, str(flags.area) || null, flags.bins ? Number(flags.bins) : null, kgIn, temp, str(flags.clearance) || null, price, holds.length ? 'held' : 'received', holds.join(' ') || null],
  );
  let text = `${ref}: ${kg(kgIn)} of ${s.name} off ${v.name}, received at ${temp} C.`;
  if (holds.length) text += `\n  HELD, not received as stock:\n${holds.map((h) => `  - ${h}`).join('\n')}\n  Decide, log it, then \`release ${ref} --note=\` or \`reject ${ref} --note=\`.`;
  else text += ' On the record as a raw lot.';
  if (s.bivalve && !row.shellfish_clearance_ref) text += `\n  Bivalve shellfish: it cannot go on the line until the harvest area clearance is recorded (\`clearance ${ref} --ref=\`).`;
  if (s.scombroid) text += `\n  Scombroid species: no case from this lot dispatches without a histamine result (\`histamine ${ref} --result=\`).`;
  return { json: row, text };
}

async function cmdClearance(db, args, flags) {
  const l = await resolve(db, 'landing', args.join(' '));
  const ref = need(flags, 'ref', 'the harvest area clearance or biotoxin clearance reference');
  await db.query('update landings set shellfish_clearance_ref = $1 where id = $2', [ref, l.id]);
  await note(db, 'landing', l.id, l.ref, `Harvest area clearance recorded: ${ref}.`);
  return { json: { ref: l.ref, shellfish_clearance_ref: ref }, text: `${l.ref}: harvest area clearance ${ref} on record. It can go on the line.` };
}

async function cmdHistamine(db, args, flags) {
  const l = await resolve(db, 'landing', args.join(' '));
  const result = Number(need(flags, 'result', 'mg/kg from the lab'));
  if (!Number.isFinite(result) || result < 0) throw new CliError('--result must be mg/kg, zero or more.');
  const on = parseDate(flags.on) || today();
  await db.query('update landings set histamine_mg_kg = $1, histamine_tested_on = $2 where id = $3', [result, on, l.id]);
  await note(db, 'landing', l.id, l.ref, `Histamine ${result} mg/kg (tested ${on}).`);
  const over = result > HISTAMINE_LIMIT;
  let text = `${l.ref}: histamine ${result} mg/kg on ${on}.`;
  if (over) {
    const [c] = await db.query("select count(*) as n from cases c join runs r on r.id = c.run_id where r.landing_id = $1 and c.status = 'in_store'", [l.id]);
    text += `\n  OVER THE ${HISTAMINE_LIMIT} mg/kg LIMIT. No case from this lot can be allocated or dispatched. ${c.n} cases in store: quarantine them (\`move\` to the hold area), then decide and \`writeoff\` with the reason.`;
  } else text += ' Under the limit: cases from this lot can dispatch.';
  return { json: { ref: l.ref, histamine_mg_kg: result, over_limit: over }, text };
}

async function cmdRelease(db, args, flags) {
  const l = await resolve(db, 'landing', args.join(' '));
  if (l.status !== 'held') throw new CliError(`${l.ref} is ${l.status}, not held.`);
  const why = need(flags, 'note', 'the decision and who made it');
  const [landing] = await db.query('select * from v_landings where landing_id = $1', [l.id]);
  if (landing.permit_lapsed_at_landing || !landing.permit_no) throw new CliError(`${l.ref} came from ${landing.fisher} without a current permit on the landing date. Record the renewed permit first (permit "${landing.fisher}" --no= --expires=), and only if it covered the landing date.`);
  await db.query("update landings set status = 'received' where id = $1", [l.id]);
  await note(db, 'landing', l.id, l.ref, `Released from hold: ${why}`);
  return { json: { ref: l.ref, status: 'received' }, text: `${l.ref} released to stock. The reason is on the record.` };
}

async function cmdReject(db, args, flags) {
  const l = await resolve(db, 'landing', args.join(' '));
  if (!['held', 'received'].includes(l.status)) throw new CliError(`${l.ref} is ${l.status}; only fish not yet processed can be rejected.`);
  const why = need(flags, 'note', 'why, and what happened to the fish');
  await db.query("update landings set status = 'rejected' where id = $1", [l.id]);
  await note(db, 'landing', l.id, l.ref, `Rejected: ${why}`);
  return { json: { ref: l.ref, status: 'rejected' }, text: `${l.ref} rejected. Not paid for, never processed, kept on the record.` };
}

async function cmdPermit(db, args, flags) {
  const f = await resolve(db, 'fisher', args.join(' '));
  const no = str(flags.no) || f.permit_no;
  const expires = parseDate(need(flags, 'expires', 'the permit expiry date'));
  await db.query('update fishers set permit_no = $1, permit_expires_on = $2 where id = $3', [no, expires, f.id]);
  await note(db, 'fisher', f.id, f.name, `Permit ${no} recorded, expires ${expires}.`);
  return { json: { fisher: f.name, permit_no: no, permit_expires_on: expires }, text: `${f.name}: permit ${no}, expires ${expires}.` };
}

async function cmdPrice(db, args, flags) {
  const l = await resolve(db, 'landing', args.join(' '));
  if (l.settlement_id) throw new CliError(`${l.ref} is already on a settlement. Prices on a settled lot do not change.`);
  const p = Number(need(flags, 'per-kg', 'the agreed price per kg'));
  if (!Number.isFinite(p) || p < 0) throw new CliError('--per-kg must be a price, zero or more.');
  await db.query('update landings set price_per_kg = $1 where id = $2', [p, l.id]);
  return { json: { ref: l.ref, price_per_kg: p }, text: `${l.ref}: ${money(p)} per kg agreed.` };
}

// ---------------------------------------------------------------------------
// Writes: the line

function parseWeights(flags, product) {
  if (flags.weights) {
    const ws = String(flags.weights).split(/[,\s]+/).filter(Boolean).map((w) => positive(w, 'Each case weight'));
    if (!ws.length) throw new CliError('--weights is empty.');
    return ws;
  }
  const count = Math.round(positive(need(flags, 'cases', 'how many cases, or --weights=17.1,17.3,...'), '--cases'));
  const total = flags.kg ? positive(flags.kg, '--kg') : num(product.nominal_case_kg) * count;
  if (!total) throw new CliError('Give --kg (total net weight) or --weights; the product has no nominal case weight.');
  const each = Math.round((total / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? Math.round((total - each * (count - 1)) * 100) / 100 : each));
}

async function defaultRoom(db, storage) {
  const kind = storage === 'frozen' ? 'freezer' : storage === 'live' ? 'live tank' : 'chiller';
  const [r] = await db.query("select name from coolrooms where kind = $1 and status = 'active' and name not ilike '%hold%' order by name limit 1", [kind]);
  return r ? r.name : null;
}

async function packCases(db, run, landing, product, weights, flags) {
  const packedOn = parseDate(flags.on) || today();
  const shelf = product.storage === 'frozen' ? num(product.frozen_shelf_days) : num(product.chilled_shelf_days);
  const useBy = addDays(packedOn, shelf);
  let room = str(flags.room) || (await defaultRoom(db, product.storage));
  if (room) room = (await resolve(db, 'room', room)).name;
  const [start] = await db.query("select coalesce(max(substring(case_no from 4)::int), 30000) as n from cases where case_no ~ '^CS-[0-9]+$'");
  let n = num(start.n);
  const made = [];
  for (const w of weights) {
    n++;
    const [c] = await db.query('insert into cases (case_no, run_id, product_id, net_kg, packed_on, use_by, room) values ($1, $2, $3, $4, $5, $6, $7) returning case_no, net_kg', [`CS-${n}`, run.id, product.id, w, packedOn, useBy, room]);
    made.push(c);
  }
  return { made, useBy, room };
}

async function cmdProcess(db, args, flags) {
  const l = await resolve(db, 'landing', args.join(' '));
  const [landing] = await db.query('select * from v_landings where landing_id = $1', [l.id]);
  if (landing.status === 'held') throw new CliError(`${l.ref} is HELD: ${landing.hold_reason}\nHeld fish does not go on the line. Decide, then release or reject it.`);
  if (landing.status === 'rejected') throw new CliError(`${l.ref} was rejected. It does not go on the line.`);
  if (landing.bivalve && !landing.shellfish_clearance_ref) throw new CliError(`${l.ref} is bivalve shellfish with no harvest area clearance on record. It cannot be processed. Record it first: clearance ${l.ref} --ref=`);
  const product = await resolve(db, 'product', need(flags, 'product', 'what it is being packed as'));
  if (product.species_code !== landing.species_code) throw new CliError(`${product.code} is a ${product.species_code} product; ${l.ref} is ${landing.species_code}. A case must trace to the fish in it.`);
  const inputKg = flags['input-kg'] ? positive(flags['input-kg'], '--input-kg') : num(landing.kg) - num(landing.kg_processed);
  if (inputKg <= 0) throw new CliError(`${l.ref} has nothing left to process (${kg(landing.kg_processed)} of ${kg(landing.kg)} already through).`);
  if (num(landing.kg_processed) + inputKg > num(landing.kg) + 0.01) throw new CliError(`${l.ref} landed ${kg(landing.kg)}; ${kg(landing.kg_processed)} is already through. ${kg(inputKg)} more would be fish that never arrived.`);
  const weights = parseWeights(flags, product);
  const ref = await nextRef(db, 'RUN', 'runs', 'ref', 700);
  const [run] = await db.query('insert into runs (ref, landing_id, run_on, input_kg, line, note) values ($1, $2, $3, $4, $5, $6) returning *', [ref, l.id, parseDate(flags.on) || today(), inputKg, str(flags.line) || null, str(flags.note) || null]);
  const { made, useBy, room } = await packCases(db, run, landing, product, weights, flags);
  await db.query("update landings set status = 'processed' where id = $1", [l.id]);
  const [r] = await db.query('select * from v_runs where run_id = $1', [run.id]);
  let text = `${ref}: ${kg(inputKg)} of ${l.ref} through the line, ${made.length} cases of ${product.code} (${made[0].case_no} to ${made[made.length - 1].case_no}), ${kg(r.output_kg)} net, yield ${num(r.yield_pct)}%.`;
  text += `\n  Use-by ${useBy}, into ${room || 'no room set'}.`;
  if (r.standard_yield_pct !== null && num(r.yield_gap) <= -5) text += `\n  YIELD LOW: ${num(r.yield_pct)}% against a standard of ${num(r.standard_yield_pct)}%. Log what happened on the line (\`log ${ref} "..."\`).`;
  if (landing.scombroid && landing.histamine_mg_kg === null) text += `\n  Scombroid lot with no histamine result: these cases cannot dispatch until one is recorded.`;
  return { json: { run: r, cases: made, use_by: useBy, room }, text };
}

async function cmdPack(db, args, flags) {
  const run = await resolve(db, 'run', args.join(' '));
  const [landing] = await db.query('select * from v_landings where landing_id = $1', [run.landing_id]);
  const product = await resolve(db, 'product', need(flags, 'product', 'what the extra output is'));
  if (product.species_code !== landing.species_code) throw new CliError(`${product.code} is a ${product.species_code} product; ${run.ref} ran ${landing.species_code}.`);
  const weights = parseWeights(flags, product);
  const { made, useBy, room } = await packCases(db, run, landing, product, weights, flags);
  const [r] = await db.query('select * from v_runs where run_id = $1', [run.id]);
  return { json: { run: r, cases: made }, text: `${run.ref}: ${made.length} more cases of ${product.code}, use-by ${useBy}, into ${room || 'no room'}. The run now yields ${num(r.yield_pct)}%.` };
}

async function cmdMove(db, args, flags) {
  const c = await resolve(db, 'case', args.join(' '));
  if (c.status !== 'in_store') throw new CliError(`${c.case_no} is ${c.status}.`);
  const room = await resolve(db, 'room', need(flags, 'room'));
  await db.query('update cases set room = $1 where id = $2', [room.name, c.id]);
  return { json: { case_no: c.case_no, room: room.name }, text: `${c.case_no} moved to ${room.name}.` };
}

async function cmdTemp(db, args, flags) {
  const room = await resolve(db, 'room', args.join(' '));
  const t = Number(need(flags, 'temp', 'the reading in C'));
  if (!Number.isFinite(t)) throw new CliError('--temp must be a number.');
  await db.query('insert into temp_checks (room_id, temp_c, checked_by, note) values ($1, $2, $3, $4)', [room.id, t, str(flags.by) || null, str(flags.note) || null]);
  const out = t < num(room.target_min_c) || t > num(room.target_max_c);
  return { json: { room: room.name, temp_c: t, out_of_range: out }, text: `${room.name}: ${t} C recorded.${out ? `  OUT OF RANGE (${num(room.target_min_c)} to ${num(room.target_max_c)} C). Record the corrective action: log "${room.name}" "..."` : ''}` };
}

async function cmdWriteoff(db, args, flags) {
  const c = await resolve(db, 'case', args.join(' '));
  if (c.status !== 'in_store') throw new CliError(`${c.case_no} is ${c.status}.`);
  const why = need(flags, 'note', 'why: past use-by, histamine, damaged');
  await db.query("update cases set status = 'written_off', order_id = null, note = $1 where id = $2", [why, c.id]);
  await note(db, 'case', c.id, c.case_no, `Written off: ${why}`);
  return { json: { case_no: c.case_no, status: 'written_off' }, text: `${c.case_no} written off. It stays on the record with the reason.` };
}

// ---------------------------------------------------------------------------
// Writes: orders and dispatch

async function cmdOrderWrite(db, args, flags) {
  const sub = args[0];
  if (sub === 'create') {
    const cu = await resolve(db, 'customer', need(flags, 'customer'));
    const ref = await nextRef(db, 'ORD', 'orders', 'ref', 5100);
    const exportOrder = Boolean(flags.export) || (cu.country && cu.country !== 'New Zealand');
    const [o] = await db.query('insert into orders (ref, customer_id, export, destination, required_on, carrier) values ($1, $2, $3, $4, $5, $6) returning *', [ref, cu.id, exportOrder, str(flags.destination) || null, parseDate(flags.required), str(flags.carrier) || null]);
    return { json: o, text: `${ref} for ${cu.name}${exportOrder ? ', EXPORT: it will need its E-cert reference before it can leave' : ''}. Add lines: order line ${ref} --product= --kg= --price=` };
  }
  if (sub === 'line') {
    const o = await resolve(db, 'order', args.slice(1).join(' '));
    if (o.status !== 'open') throw new CliError(`${o.ref} is ${o.status}.`);
    const p = await resolve(db, 'product', need(flags, 'product'));
    const k = positive(need(flags, 'kg'), '--kg');
    const pr = Number(need(flags, 'price', 'price per kg'));
    if (!Number.isFinite(pr) || pr < 0) throw new CliError('--price must be a price per kg.');
    const [line] = await db.query('insert into order_lines (order_id, product_id, kg_ordered, price_per_kg) values ($1, $2, $3, $4) returning *', [o.id, p.id, k, pr]);
    return { json: line, text: `${o.ref}: ${kg(k)} of ${p.code} at ${money(pr)}/kg. Invoiced at the cases' real net weight.` };
  }
  if (sub === 'cancel') {
    const o = await resolve(db, 'order', args.slice(1).join(' '));
    if (o.status !== 'open') throw new CliError(`${o.ref} is ${o.status}.`);
    await db.query('update cases set order_id = null where order_id = $1', [o.id]);
    await db.query("update orders set status = 'cancelled' where id = $1", [o.id]);
    await note(db, 'order', o.id, o.ref, `Cancelled: ${str(flags.note) || 'no reason given'}`);
    return { json: { ref: o.ref, status: 'cancelled' }, text: `${o.ref} cancelled; its cases are back in free stock.` };
  }
  throw new CliError('order create --customer= | order line <ORD> --product= --kg= --price= | order cancel <ORD>');
}

async function cmdAllocate(db, args, flags) {
  const o = await resolve(db, 'order', need(flags, 'to', 'the order'));
  if (o.status !== 'open') throw new CliError(`${o.ref} is ${o.status}.`);
  const q = args.join(' ');
  let caseIds;
  if (/^run-/i.test(q.trim())) {
    const run = await resolve(db, 'run', q);
    const count = flags.count ? Math.round(positive(flags.count, '--count')) : null;
    const rows = await db.query("select id from cases where run_id = $1 and status = 'in_store' and order_id is null order by case_no", [run.id]);
    caseIds = (count ? rows.slice(0, count) : rows).map((r) => r.id);
    if (count && caseIds.length < count) throw new CliError(`${run.ref} has only ${caseIds.length} free cases in store.`);
    if (!caseIds.length) throw new CliError(`${run.ref} has no free cases in store.`);
  } else {
    caseIds = [(await resolve(db, 'case', q)).id];
  }
  const cases = await db.query('select * from v_cases where case_id = any($1::uuid[]) order by case_no', [caseIds]);
  const lines = await db.query('select product_id from order_lines where order_id = $1', [o.id]);
  const lineProducts = new Set(lines.map((l) => l.product_id));
  for (const c of cases) {
    if (c.status !== 'in_store') throw new CliError(`${c.case_no} is ${c.status}.`);
    if (c.order_id && c.order_id !== o.id) throw new CliError(`${c.case_no} is already on ${c.order_ref}.`);
    if (num(c.days_to_use_by) < 0) throw new CliError(`${c.case_no} is past its use-by (${isoDate(c.use_by)}). It does not go on an order.`);
    if (c.scombroid && num(c.histamine_mg_kg) > HISTAMINE_LIMIT) throw new CliError(`${c.case_no} is from ${c.landing_ref}, which tested ${num(c.histamine_mg_kg)} mg/kg histamine, over the ${HISTAMINE_LIMIT} mg/kg limit. It cannot be sold.`);
    if (lineProducts.size && !lineProducts.has(c.product_id)) throw new CliError(`${c.case_no} is ${c.product_code}, which is not on ${o.ref}. Add the line first.`);
  }
  await db.query('update cases set order_id = $1 where id = any($2::uuid[])', [o.id, caseIds]);
  const total = cases.reduce((a, c) => a + num(c.net_kg), 0);
  const untested = cases.filter((c) => c.scombroid && c.histamine_mg_kg === null).length;
  let text = `${cases.length} case${cases.length === 1 ? '' : 's'} (${total.toFixed(2)} kg net) allocated to ${o.ref}.`;
  if (untested) text += `\n  ${untested} from a scombroid lot with no histamine result: ${o.ref} cannot dispatch until it is recorded.`;
  return { json: { order: o.ref, cases: cases.map((c) => c.case_no), kg: total }, text };
}

async function cmdUnallocate(db, args) {
  const c = await resolve(db, 'case', args.join(' '));
  if (c.status !== 'in_store' || !c.order_id) throw new CliError(`${c.case_no} is not allocated to an open order.`);
  await db.query('update cases set order_id = null where id = $1', [c.id]);
  return { json: { case_no: c.case_no }, text: `${c.case_no} back in free stock.` };
}

async function cmdEcert(db, args, flags) {
  const o = await resolve(db, 'order', args.join(' '));
  if (!o.export) throw new CliError(`${o.ref} is a domestic order; it needs no E-cert.`);
  const ref = need(flags, 'ref', 'the E-cert / official assurance reference');
  await db.query('update orders set ecert_ref = $1 where id = $2', [ref, o.id]);
  await note(db, 'order', o.id, o.ref, `E-cert ${ref} on record.`);
  return { json: { ref: o.ref, ecert_ref: ref }, text: `${o.ref}: E-cert ${ref} on record.` };
}

async function cmdDispatch(db, args, flags) {
  const o = await resolve(db, 'order', args.join(' '));
  if (o.status !== 'open') throw new CliError(`${o.ref} is ${o.status}.`);
  const [order] = await db.query('select * from v_orders where order_id = $1', [o.id]);
  const cases = await db.query('select * from v_cases where order_id = $1', [o.id]);
  const blockers = dispatchBlockers(order, cases);
  if (blockers.length) throw new CliError(`${o.ref} cannot dispatch:\n${blockers.map((b) => `  - ${b}`).join('\n')}\nThere is no force flag.`);
  const on = parseDate(flags.on) || today();
  await db.query("update cases set status = 'dispatched' where order_id = $1", [o.id]);
  await db.query("update orders set status = 'dispatched', dispatched_on = $1, carrier = coalesce($2, carrier) where id = $3", [on, str(flags.carrier) || null, o.id]);
  return { json: { ref: o.ref, dispatched_on: on, cases: cases.length, kg: num(order.kg_allocated), invoice_value: num(order.invoice_value) }, text: `${o.ref} dispatched ${on}: ${cases.length} cases, ${kg(order.kg_allocated)} net, ${money(order.invoice_value)} at catch weight. The trace forward is on record.` };
}

// ---------------------------------------------------------------------------
// Writes: paying fishers

async function cmdSettle(db, args, flags) {
  const f = await resolve(db, 'fisher', args.join(' '));
  const to = parseDate(flags.to) || today();
  const lines = await db.query("select * from v_settlement_lines where fisher_id = $1 and settlement_id is null and landed_on <= $2 and status in ('received', 'processed', 'held') order by landed_on", [f.id, to]);
  const held = lines.filter((l) => l.status === 'held');
  const payable = lines.filter((l) => l.status !== 'held');
  const unpriced = payable.filter((l) => l.price_per_kg === null);
  if (unpriced.length) throw new CliError(`Cannot settle ${f.name}: ${unpriced.map((l) => l.ref).join(', ')} ha${unpriced.length === 1 ? 's' : 've'} no price. Agree it first: price <lot> --per-kg=`);
  if (!payable.length) throw new CliError(`${f.name} has nothing to settle up to ${to}.${held.length ? ` ${held.length} held landing(s) wait on a decision.` : ''}`);
  const ref = await nextRef(db, 'SET', 'settlements', 'ref', 900);
  if (flags['dry-run']) {
    const net = payable.reduce((a, l) => a + num(l.net), 0);
    return { json: { dry_run: true, fisher: f.name, lines: payable, net }, text: `Dry run: ${ref} for ${f.name} would cover ${payable.length} lots, net ${money(net)}.` };
  }
  const [s] = await db.query('insert into settlements (ref, fisher_id, period_to) values ($1, $2, $3) returning *', [ref, f.id, to]);
  await db.query('update landings set settlement_id = $1 where id = any($2::uuid[])', [s.id, payable.map((l) => l.landing_id)]);
  const [sum] = await db.query('select * from v_settlements where settlement_id = $1', [s.id]);
  let text = `${ref}: ${f.name} to ${to}, ${sum.landings} lots, ${kg(sum.kg)}, gross ${money(sum.gross)}, deductions ${money(sum.deductions)}, net ${money(sum.net)}. Draft: the statement renders with npm run docs; mark it paid when the money goes (paid ${ref}).`;
  if (held.length) text += `\n  Not included: ${held.map((l) => l.ref).join(', ')} (held, not bought until decided).`;
  return { json: sum, text };
}

async function cmdPaid(db, args, flags) {
  const s = await resolve(db, 'settlement', args.join(' '));
  if (s.status === 'paid') throw new CliError(`${s.ref} is already paid.`);
  const on = parseDate(flags.on) || today();
  await db.query("update settlements set status = 'paid', paid_on = $1 where id = $2", [on, s.id]);
  return { json: { ref: s.ref, paid_on: on }, text: `${s.ref} marked paid ${on}. Final.` };
}

// ---------------------------------------------------------------------------
// Housekeeping

async function cmdLog(db, args) {
  const [target, ...rest] = args;
  const body = rest.join(' ').trim();
  if (!target || !body) throw new CliError('log <lot | run | case | order | fisher | room> "what happened"');
  const tries = [['landing', 'ref'], ['run', 'ref'], ['case', 'case_no'], ['order', 'ref'], ['settlement', 'ref'], ['fisher', 'name'], ['room', 'name'], ['customer', 'name']];
  for (const [kind, labelCol] of tries) {
    let hit = null;
    try {
      hit = await resolve(db, kind, target, { optional: true });
    } catch {
      hit = null;
    }
    if (hit) {
      await note(db, kind, hit.id, hit[labelCol], body);
      return { json: { kind, label: hit[labelCol], body }, text: `Noted on ${hit[labelCol]}.` };
    }
  }
  throw new CliError(`Nothing matches "${target}".`);
}

async function cmdAdd(db, args, flags) {
  const [kind, ...rest] = args;
  const name = rest.join(' ').trim();
  if (kind === 'fisher') {
    if (!name) throw new CliError('add fisher "<name>" --code= --permit= --permit-expires=');
    const [r] = await db.query('insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, deduction_per_kg) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *', [str(flags.code) || null, name, str(flags.contact) || null, str(flags.phone) || null, str(flags.email) || null, str(flags.permit) || null, parseDate(flags['permit-expires']), Number(flags.deduction || 0)]);
    return { json: r, text: `Fisher ${name} added.${r.permit_no ? '' : ' No permit on record: their landings will be held until one is.'}` };
  }
  if (kind === 'vessel') {
    const f = await resolve(db, 'fisher', need(flags, 'fisher'));
    const [r] = await db.query('insert into vessels (fisher_id, name, registration, method, home_port) values ($1, $2, $3, $4, $5) returning *', [f.id, name, str(flags.registration) || null, str(flags.method) || 'trawl', str(flags.port) || null]);
    return { json: r, text: `Vessel ${name} added for ${f.name}.` };
  }
  if (kind === 'species') {
    const [r] = await db.query('insert into species (code, name, kind, scombroid, bivalve, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *', [need(flags, 'code').toUpperCase(), name, str(flags.kind) || 'finfish', Boolean(flags.scombroid), Boolean(flags.bivalve), flags.yield ? Number(flags.yield) : null, Number(flags['shelf-days'] || 7), Number(flags['receive-max'] || 4), flags.price ? Number(flags.price) : null]);
    return { json: r, text: `Species ${r.code} ${name} added.` };
  }
  if (kind === 'product') {
    const s = await resolve(db, 'species', need(flags, 'species'));
    const [r] = await db.query('insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *', [need(flags, 'code').toUpperCase(), name, s.id, str(flags.form) || 'fillet', str(flags.storage) || 'chilled', flags['case-kg'] ? Number(flags['case-kg']) : null, str(flags.allergen) || null, str(flags.origin) || null]);
    return { json: r, text: `Product ${r.code} added.${r.allergen_statement ? '' : ' No allergen statement yet: compliance will flag it.'}` };
  }
  if (kind === 'customer') {
    const [r] = await db.query('insert into customers (name, country, contact_name, email) values ($1, $2, $3, $4) returning *', [name, str(flags.country) || 'New Zealand', str(flags.contact) || null, str(flags.email) || null]);
    return { json: r, text: `Customer ${name} added.` };
  }
  if (kind === 'room') {
    const [r] = await db.query('insert into coolrooms (name, kind, target_min_c, target_max_c) values ($1, $2, $3, $4) returning *', [name, str(flags.kind) || 'chiller', Number(need(flags, 'min')), Number(need(flags, 'max'))]);
    return { json: r, text: `${name} added (${r.target_min_c} to ${r.target_max_c} C).` };
  }
  throw new CliError('add fisher | vessel | species | product | customer | room "<name>" [--flags]');
}

// ---------------------------------------------------------------------------
// Compliance: the rule book, run against the records. docs/compliance.md has
// the fuller reading and the sources.

const RULES = [
  {
    key: 'permit',
    title: 'Fish bought only from a current permit holder',
    source: 'Fisheries Act 1996 (licensed fish receivers acquire fish only from permit holders)',
    fix: 'hold the landing; record the renewed permit with `permit`, or reject',
    sql: `select ref as label, fisher || ' had no current permit on ' || landed_on || ' and the landing is ' || status as detail
          from v_landings where (permit_lapsed_at_landing or permit_no is null) and status in ('received', 'processed')`,
  },
  {
    key: 'landing-report',
    title: "Every landing carries the fisher's landing report reference",
    source: 'Fisheries (Reporting) Regulations 2017 (electronic catch and landing reporting); the LFR return reconciles against it',
    fix: 'get the reference from the fisher and record it',
    sql: `select ref as label, fisher || ', ' || kg || ' kg ' || species || ', no landing report reference' as detail from v_landings where landing_report_ref is null and status <> 'rejected'`,
  },
  {
    key: 'receiving-temp',
    title: 'Fish above its receiving limit is decided inside 24 hours',
    source: 'Animal Products Act 1999; your Risk Management Programme (RMP) receiving critical limit',
    fix: 'core temp recheck and sensory, then `release --note=` or `reject --note=`',
    sql: `select ref as label, 'received at ' || receive_temp_c || ' C (limit ' || receive_max_c || ' C), held ' || days_since_landing || ' day(s) undecided' as detail
          from v_landings where status = 'held' and temp_breach and days_since_landing >= 1
          union all
          select ref, 'no receiving temperature recorded' from v_landings where receive_temp_c is null and status <> 'rejected'`,
  },
  {
    key: 'histamine',
    title: 'Scombroid fish is tested, and never sold above 200 mg/kg histamine',
    source: 'Australia New Zealand Food Standards Code, Schedule 19 (histamine in fish, 200 mg/kg); your RMP histamine controls',
    fix: 'send a sample, record it with `histamine`; quarantine and write off a lot over the limit',
    sql: `select order_ref as label, count(*) || ' cases from ' || string_agg(distinct landing_ref, ', ') || ' allocated or shipped with no histamine result' as detail
          from v_cases where scombroid and histamine_mg_kg is null and order_id is not null group by order_ref
          union all
          select landing_ref, count(*) || ' cases from a lot at ' || max(histamine_mg_kg) || ' mg/kg still ' || string_agg(distinct status, '/') from v_cases
          where scombroid and histamine_mg_kg > 200 and status <> 'written_off' group by landing_ref`,
  },
  {
    key: 'shellfish-clearance',
    title: 'Bivalve shellfish carries its harvest area clearance',
    source: 'Animal Products Notice: Regulated Control Scheme, Bivalve Molluscan Shellfish for Human Consumption (MPI)',
    fix: 'record the clearance with `clearance <lot> --ref=` before it goes on the line',
    sql: `select ref as label, kg || ' kg ' || species || ' from area ' || coalesce(stat_area, '?') || ', no clearance on record (' || status || ')' as detail
          from v_landings where bivalve and shellfish_clearance_ref is null and status in ('received', 'processed')`,
  },
  {
    key: 'traceability',
    title: 'Every lot records where it was caught and on which trip',
    source: 'Animal Products Act 1999 and your RMP traceability and recall procedures (one step back, one step forward)',
    fix: 'add the statistical area and trip from the landing report',
    sql: `select ref as label, 'missing ' || concat_ws(' and ', case when stat_area is null then 'area' end, case when trip_ref is null then 'trip' end) as detail
          from v_landings where (stat_area is null or trip_ref is null) and status <> 'rejected'`,
  },
  {
    key: 'export-assurance',
    title: 'No export leaves without its E-cert reference',
    source: 'Animal Products Act 1999 (exports) and MPI official assurance requirements for the market',
    fix: 'request the E-cert, record it with `ecert <order> --ref=`',
    sql: `select ref as label, 'export to ' || coalesce(destination, '?') || ' ' || case when status = 'dispatched' then 'dispatched' else 'required ' || coalesce(required_on::text, '?') end || ' with no E-cert reference' as detail
          from v_orders where export and ecert_ref is null and (status = 'dispatched' or (status = 'open' and cases > 0 and required_on <= current_date + 2))`,
  },
  {
    key: 'allergen-labelling',
    title: 'Every product declares fish, crustacea or mollusc on the label',
    source: 'Australia New Zealand Food Standards Code, Standard 1.2.3 (mandatory declaration of fish, crustacea and mollusc)',
    fix: 'add the allergen statement to the product specification',
    sql: `select code as label, name || ' has no allergen statement' as detail from products where status = 'active' and (allergen_statement is null or allergen_statement = '')`,
  },
  {
    key: 'origin-labelling',
    title: 'Fresh and frozen seafood for NZ retail states its country of origin',
    source: 'Consumer Information Standards (Origin of Food) Regulations 2021 (New Zealand)',
    fix: 'add the origin statement to the product specification',
    sql: `select code as label, name || ' has no country of origin statement' as detail from products where status = 'active' and (origin_statement is null or origin_statement = '')`,
  },
  {
    key: 'cold-store',
    title: 'Every chiller and freezer checked inside 24 hours and inside its band',
    source: 'Your RMP temperature monitoring procedure; the bands are your own',
    fix: 'record a check with `temp`; for out-of-range, the corrective action with `log`',
    sql: `select room as label, case state when 'OUT OF RANGE' then 'last reading ' || last_temp_c || ' C, band ' || target_min_c || ' to ' || target_max_c || ' C, ' || cases_in_room || ' cases inside' else lower(state) end as detail
          from v_coolstore where state <> 'ok'`,
  },
  {
    key: 'use-by',
    title: 'No case sits in store past its use-by',
    source: 'Australia New Zealand Food Standards Code, Standard 1.2.5 (use-by dates); your own shelf life validation',
    fix: '`writeoff <case> --note=`',
    sql: `select run_ref as label, count(*) || ' cases of ' || min(product_code) || ' past use-by ' || min(use_by) as detail from v_cases where status = 'in_store' and use_by < current_date group by run_ref`,
  },
  {
    key: 'fisher-settlement',
    title: 'Fishers settled inside 14 days of landing',
    source: 'Your supply agreement with your fishers (change the 14 days to yours)',
    fix: '`settle <fisher>`',
    sql: `select ref as label, fisher || ', landed ' || landed_on || ', ' || (current_date - landed_on) || ' days unsettled' as detail
          from v_settlement_lines where settlement_id is null and status in ('received', 'processed') and landed_on < current_date - 14`,
  },
];

async function cmdCompliance(db, args) {
  const only = args[0];
  const rules = only ? RULES.filter((r) => r.key === only) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const rule of rules) {
    const breaches = await db.query(rule.sql);
    results.push({ key: rule.key, title: rule.title, source: rule.source, fix: rule.fix, breaches });
  }
  let text = heading('The rule book, run against the records');
  for (const r of results) {
    text += `\n\n${r.breaches.length ? 'FAIL' : ' ok '} ${r.key}: ${r.title}`;
    text += `\n      ${r.source}`;
    for (const b of r.breaches) text += `\n      - ${b.label}: ${b.detail}`;
    if (r.breaches.length) text += `\n      fix: ${r.fix}`;
  }
  const failed = results.filter((r) => r.breaches.length).length;
  text += `\n\n${results.length - failed} of ${results.length} rules pass. Sources and the fuller reading: docs/compliance.md. None of this is legal advice.`;
  return { json: results, text };
}

// ---------------------------------------------------------------------------
// Import and export

function readCsvFile(file) {
  if (!file || file === true) return [];
  return parseCsv(readFileSync(path.resolve(String(file)), 'utf8'));
}

async function cmdImport(db, args, flags) {
  const source = args[0];
  if (!['aptean', 'businesscentral', 'bc', 'csv'].includes(source)) throw new CliError('import aptean|businesscentral|csv --fishers=vendors.csv [--vessels=vessels.csv --landings=receipts.csv --customers=customers.csv] [--dry-run]');
  const dry = Boolean(flags['dry-run']);
  const report = { fishers: 0, vessels: 0, landings: 0, customers: 0, skipped: [], warnings: [] };
  await db.exec('BEGIN');
  try {
    for (const row of readCsvFile(flags.fishers)) {
      const name = pick(row, 'Name', 'Vendor Name', 'Fisher', 'Supplier');
      if (!name) { report.skipped.push(`fisher row with no name: ${JSON.stringify(row).slice(0, 80)}`); continue; }
      const code = pick(row, 'No.', 'No', 'Vendor No.', 'Code') || null;
      const exists = await db.query('select id from fishers where lower(name) = lower($1) or (code is not null and code = $2)', [name, code]);
      if (exists.length) { report.skipped.push(`fisher ${name}: already here`); continue; }
      const permit = pick(row, 'Permit No.', 'Permit', 'Fishing Permit') || null;
      const expires = pick(row, 'Permit Expiry', 'Permit Expires', 'Permit Expiry Date');
      await db.query('insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, external_ref) values ($1, $2, $3, $4, $5, $6, $7, $8)', [code, name, pick(row, 'Contact') || null, pick(row, 'Phone No.', 'Phone') || null, pick(row, 'E-Mail', 'Email') || null, permit, expires ? parseDate(expires) : null, code]);
      report.fishers++;
      if (!permit) report.warnings.push(`${name}: no permit number: their next landing will be held`);
    }
    for (const row of readCsvFile(flags.vessels)) {
      const name = pick(row, 'Vessel', 'Vessel Name', 'Name');
      const fisherQ = pick(row, 'Vendor No.', 'Fisher', 'Vendor', 'Owner');
      if (!name || !fisherQ) { report.skipped.push(`vessel row missing name or fisher: ${JSON.stringify(row).slice(0, 80)}`); continue; }
      const f = await resolve(db, 'fisher', fisherQ, { optional: true }).catch(() => null);
      if (!f) { report.skipped.push(`vessel ${name}: no fisher matches "${fisherQ}"`); continue; }
      await db.query('insert into vessels (fisher_id, name, registration, method, home_port, external_ref) values ($1, $2, $3, $4, $5, $6)', [f.id, name, pick(row, 'Registration', 'Reg No.', 'Vessel No.') || null, (pick(row, 'Method') || 'other').toLowerCase().match(/^(trawl|longline|set net|potting|dredge|diving|handline|farm)$/) ? pick(row, 'Method').toLowerCase() : 'other', pick(row, 'Home Port', 'Port') || null, pick(row, 'Registration') || null]);
      report.vessels++;
    }
    for (const row of readCsvFile(flags.landings)) {
      const lot = pick(row, 'Lot No.', 'Lot No', 'Lot', 'Document No.');
      const vesselQ = pick(row, 'Vessel', 'Vessel Name');
      const speciesQ = pick(row, 'Species', 'Species Code', 'Item No.', 'Item');
      const kgs = Number(pick(row, 'Quantity', 'Kg', 'Weight', 'Net Weight'));
      if (!vesselQ || !speciesQ || !(kgs > 0)) { report.skipped.push(`landing ${lot || '?'}: needs vessel, species and a weight`); continue; }
      const v = await resolve(db, 'vessel', vesselQ, { optional: true }).catch(() => null);
      const s = await resolve(db, 'species', speciesQ, { optional: true }).catch(() => null);
      if (!v || !s) { report.skipped.push(`landing ${lot || '?'}: ${!v ? `no vessel "${vesselQ}"` : `no species "${speciesQ}"`}`); continue; }
      if (lot && (await db.query('select 1 from landings where external_ref = $1', [lot])).length) { report.skipped.push(`landing ${lot}: already here`); continue; }
      const ref = await nextRef(db, 'LND', 'landings', 'ref', 2100);
      const temp = pick(row, 'Temperature', 'Temp', 'Receive Temp');
      const reportRef = pick(row, 'Landing Report', 'Landing Report No.', 'LR No.') || null;
      const status = (pick(row, 'Status') || '').toLowerCase().includes('process') ? 'processed' : 'received';
      await db.query('insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, kg, receive_temp_c, price_per_kg, status, external_ref) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [ref, v.id, s.id, parseDate(pick(row, 'Posting Date', 'Landed', 'Date', 'Receipt Date')) || today(), pick(row, 'Trip', 'Trip No.') || null, reportRef, pick(row, 'Area', 'Stat Area', 'Statistical Area') || null, kgs, temp === '' ? null : Number(temp), pick(row, 'Unit Cost', 'Price', 'Price per kg') ? Number(pick(row, 'Unit Cost', 'Price', 'Price per kg')) : null, status, lot || null]);
      report.landings++;
      if (!reportRef) report.warnings.push(`${ref} (${lot || 'no lot'}): no landing report reference`);
      if (temp === '') report.warnings.push(`${ref} (${lot || 'no lot'}): no receiving temperature`);
    }
    for (const row of readCsvFile(flags.customers)) {
      const name = pick(row, 'Name', 'Customer', 'Customer Name');
      if (!name) continue;
      if ((await db.query('select 1 from customers where lower(name) = lower($1)', [name])).length) { report.skipped.push(`customer ${name}: already here`); continue; }
      await db.query('insert into customers (name, country, contact_name, email, external_ref) values ($1, $2, $3, $4, $5)', [name, pick(row, 'Country/Region Code', 'Country') === 'AU' ? 'Australia' : pick(row, 'Country') || 'New Zealand', pick(row, 'Contact') || null, pick(row, 'E-Mail', 'Email') || null, pick(row, 'No.') || null]);
      report.customers++;
    }
    await db.exec(dry ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  let text = `${dry ? 'Dry run (nothing written)' : 'Imported'}: ${report.fishers} fishers, ${report.vessels} vessels, ${report.landings} landings, ${report.customers} customers.`;
  if (report.skipped.length) text += `\nSkipped (${report.skipped.length}):\n${report.skipped.map((s) => `  - ${s}`).join('\n')}`;
  if (report.warnings.length) text += `\nThe first audit (${report.warnings.length}):\n${report.warnings.map((s) => `  - ${s}`).join('\n')}`;
  if (!dry) text += '\nNow run: attention, compliance.';
  return { json: { dry_run: dry, ...report }, text };
}

async function cmdExport(db, args, flags) {
  const tables = ['fishers', 'vessels', 'species', 'products', 'landings', 'runs', 'cases', 'customers', 'orders', 'order_lines', 'settlements', 'coolrooms', 'temp_checks', 'notes'];
  const out = {};
  for (const t of tables) out[t] = await db.query(`select * from ${t} order by created_at`);
  const counts = Object.fromEntries(tables.map((t) => [t, out[t].length]));
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `seafood-export-${today()}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  return { json: { file, counts }, text: `Exported the whole database to ${file}.\n  ` + Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(', ') + '\nPlain JSON of plain tables. It is part of your traceability record; keep the exports.' };
}

// ---------------------------------------------------------------------------
// Help and dispatch

const HELP = `
Seafood Processing for Claude Code: the CLI behind the slash commands.

  node scripts/seafood.mjs <command> [args] [--flags]     (or: npm run seafood -- <command>)

Fish in (the landing is the raw lot, with the gates at the door):
  land <vessel> --species= --kg= --temp= --report= [--trip= --area= --bins= --clearance= --price= --on=]
  clearance <lot> --ref=          bivalves: the harvest area clearance; the line unblocks
  histamine <lot> --result=       scombroid: mg/kg from the lab (limit 200)
  release <lot> --note=  |  reject <lot> --note=  |  permit <fisher> --no= --expires=  |  price <lot> --per-kg=

The line:
  process <lot> --product= (--weights=17.1,17.3,... | --cases= [--kg=]) [--input-kg= --room= --line=]
  pack <run> --product= (--weights= | --cases= [--kg=])     more output from the same run
  move <case> --room=  |  temp <room> --temp= [--by=]  |  writeoff <case> --note=

Orders and dispatch:
  order create --customer= [--export --destination= --required= --carrier=]
  order line <order> --product= --kg= --price=   |  order cancel <order>
  allocate <case | run> --to=<order> [--count=]     refuses past use-by and over-limit histamine
  ecert <order> --ref=                              the export certificate reference
  dispatch <order>                                  refuses: no E-cert on export, untested scombroid. No force flag.

Paying fishers:
  settle <fisher> [--to= --dry-run]   |  paid <settlement>

Reads:
  attention                 everything that wants a decision, worst first
  week | stats              the last seven days on one screen
  landings [--status= --fisher= --species= --all]      landing <lot>    the full card
  runs [--days=]            yields by run and by species
  cases [--room= --product= --order= --unallocated --all]   store (stock by product)
  trace <case | lot>        one step back, one step forward
  orders [--all]  |  order <ref>  |  coolstore  |  settlements  |  settlement <ref>
  fishers [--all]  |  fisher <name>  |  vessels  |  species  |  products
  compliance [rule]         twelve rules from the Acts, the Food Standards Code and your RMP, sources cited

Housekeeping:
  add fisher|vessel|species|product|customer|room "<name>" [--flags]
  log <record> "what happened"
  import aptean|businesscentral|csv --fishers= [--vessels= --landings= --customers=] [--dry-run]
  export [--out=file.json]

Any command takes --json. Refs match case-insensitively ("2104" finds LND-2104); an ambiguous name lists
the candidates rather than guessing. Nothing here connects to MPI, FishServe or a customer, and nothing sends.
`;

const COMMANDS = {
  attention: cmdAttention,
  week: cmdWeek,
  stats: cmdStats,
  fishers: cmdFishers,
  fisher: cmdFisher,
  vessels: cmdVessels,
  species: cmdSpecies,
  products: cmdProducts,
  landings: cmdLandings,
  landing: cmdLanding,
  lot: cmdLanding,
  runs: cmdRuns,
  yields: cmdRuns,
  cases: cmdCases,
  store: cmdStore,
  trace: cmdTrace,
  orders: cmdOrders,
  order: async (db, args, flags) => (['create', 'line', 'cancel'].includes(args[0]) ? cmdOrderWrite(db, args, flags) : cmdOrder(db, args, flags)),
  coolstore: cmdCoolstore,
  settlements: cmdSettlements,
  settlement: cmdSettlement,
  land: cmdLand,
  clearance: cmdClearance,
  histamine: cmdHistamine,
  release: cmdRelease,
  reject: cmdReject,
  permit: cmdPermit,
  price: cmdPrice,
  process: cmdProcess,
  pack: cmdPack,
  move: cmdMove,
  temp: cmdTemp,
  writeoff: cmdWriteoff,
  allocate: cmdAllocate,
  unallocate: cmdUnallocate,
  ecert: cmdEcert,
  dispatch: cmdDispatch,
  settle: cmdSettle,
  paid: cmdPaid,
  compliance: cmdCompliance,
  log: cmdLog,
  add: cmdAdd,
  import: cmdImport,
  export: cmdExport,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  const db = await getDb();
  try {
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    if (/relation "?\w+"? does not exist/.test(e.message)) {
      process.stderr.write('The database has no tables yet. Run: npm run migrate\n');
      return 1;
    }
    throw e;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
