#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.
// Set TEST_DATABASE_URL to run the same checks against a disposable Postgres.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'seafood-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL;
const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) env.DATABASE_URL = pgUrl;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);
const S = 'seafood.mjs';

console.log(`smoke: ${pgUrl ? 'Postgres at TEST_DATABASE_URL' : `data dir ${dataDir}`}`);
try {
  if (pgUrl) {
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: pgUrl });
    await c.connect();
    await c.query('drop schema public cascade; create schema public;');
    await c.end();
  }
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs', '--demo-database'], { json: false });
  run('seed again (idempotent)', ['seed.mjs', '--demo-database'], { json: false });

  // ---- the fishers -------------------------------------------------------------

  const stats = run('stats', [S, 'stats']);
  assert(stats.fishers === 6 && stats.landings === 10 && stats.cases === 138, `six fishers, ten landings, 138 cases (${stats.fishers}, ${stats.landings}, ${stats.cases})`);

  const fishers = run('fishers and permits', [S, 'fishers']);
  assert(fishers[0].code === 'GBPC' && fishers[0].permit === 'EXPIRED', 'the expired permit sorts first');
  assert(fishers.find((f) => f.code === 'MSSF').permit === 'expiring', 'and the expiring one is flagged');

  const fisher = run('fisher card by partial name', [S, 'fisher', 'Te Awa']);
  assert(fisher.fisher.code === 'TEAW', 'resolved by partial name');
  assert(fisher.unsettled.length === 3, `three lots unsettled (${fisher.unsettled.length})`);

  const noSuch = run('an unknown fisher exits 1', [S, 'fisher', 'nobody at all'], { json: false, expectFail: true });
  assert(/No fisher matches/.test(noSuch.stderr), 'and says so plainly');
  const ambiguous = run('an ambiguous name lists candidates', [S, 'fisher', 'a'], { json: false, expectFail: true });
  assert(/matches \d+ fisher records/.test(ambiguous.stderr), 'with the candidates listed');

  run('vessels', [S, 'vessels']);
  const species = run('species', [S, 'species']);
  assert(species.filter((s) => s.scombroid).length === 2 && species.filter((s) => s.bivalve).length === 1, 'two scombroid species, one bivalve');

  // ---- the attention list and the rule book -----------------------------------------

  const attention = run('attention', [S, 'attention']);
  const reasons = attention.map((a) => a.reason);
  assert(reasons[0] === 'landing_held', 'held landings come first');
  for (const r of ['histamine_over', 'shellfish_no_clearance', 'histamine_missing', 'ecert_missing', 'coolstore_out_of_range', 'use_by_passed', 'permit_expired', 'order_late', 'landing_unprocessed', 'yield_low', 'use_by_close', 'coolstore_quiet', 'permit_expiring']) {
    assert(reasons.includes(r), `attention carries ${r}`);
  }

  const compliance = run('compliance', [S, 'compliance']);
  assert(compliance.length === 12, `twelve rules (${compliance.length})`);
  const failing = compliance.filter((r) => r.breaches.length).map((r) => r.key).sort();
  assert(JSON.stringify(failing) === JSON.stringify(['allergen-labelling', 'cold-store', 'export-assurance', 'histamine', 'receiving-temp', 'shellfish-clearance', 'use-by']), `the seven expected rules fail (${failing})`);
  const one = run('one rule', [S, 'compliance', 'allergen-labelling']);
  assert(one.length === 1 && one[0].breaches[0].label === 'SCA-MEAT-C', 'the scallop spec has no allergen statement');

  // ---- fish in, and the gates at the door ----------------------------------------------

  const floor = run('landings on the floor', [S, 'landings']);
  assert(floor.length === 4 && floor[0].status === 'held', `four on the floor, held first (${floor.length})`);
  const all = run('landings --all', [S, 'landings', '--all']);
  assert(all.length === 10, 'ten on the record');

  const l2104 = run('a landing by bare number', [S, 'landing', '2104']);
  assert(l2104.landing.ref === 'LND-2104' && l2104.landing.scombroid && l2104.landing.histamine_mg_kg === null, 'LND-2104 is untested albacore');

  run('a landing without a landing report is refused', [S, 'land', 'San Marino', '--species=SNA', '--kg=400', '--temp=2'], { json: false, expectFail: true });
  run('a landing without a temperature is refused', [S, 'land', 'San Marino', '--species=SNA', '--kg=400', '--report=LR-1'], { json: false, expectFail: true });

  const good = run('land snapper', [S, 'land', 'San Marino', '--species=SNA', '--kg=600', '--temp=1.5', '--report=LR-7750001', '--trip=SM-0413', '--area=038']);
  assert(good.ref === 'LND-2111' && good.status === 'received', 'LND-2111 received');

  const warm = run('warm fish is held, not received', [S, 'land', 'Moana Rose', '--species=GUR', '--kg=200', '--temp=7.2', '--report=LR-7750002', '--area=038', '--trip=MR-0255']);
  assert(warm.status === 'held' && /receiving limit/.test(warm.hold_reason), 'held on temperature');

  const lapsed = run('a lapsed permit is held at the door', [S, 'land', 'Rewa', '--species=CRA', '--kg=90', '--temp=12', '--report=LR-7750003', '--area=935', '--trip=RW-0089']);
  assert(lapsed.status === 'held' && /permit/.test(lapsed.hold_reason), 'held on the permit');

  const rel = run('releasing a permit hold is refused', [S, 'release', 'LND-2105', '--note=looks fine'], { json: false, expectFail: true });
  assert(/permit/.test(rel.stderr), 'until the permit is sorted');
  run('release needs a note', [S, 'release', warm.ref], { json: false, expectFail: true });
  run('release a temperature hold with the decision', [S, 'release', warm.ref, '--note=Core temp recheck 3.1 C, sensory pass. QA: Ana.']);
  run('reject the lapsed-permit lobster', [S, 'reject', lapsed.ref, '--note=Permit not renewed. Returned to fisher.']);

  // ---- the line ---------------------------------------------------------------------

  const held = run('held fish does not go on the line', [S, 'process', 'LND-2107', '--product=GUR-WHL-C', '--cases=10'], { json: false, expectFail: true });
  assert(/HELD/.test(held.stderr), 'with the reason');
  const shell = run('shellfish without clearance does not go on the line', [S, 'process', 'LND-2106', '--product=SCA-MEAT-C', '--cases=10', '--kg=70'], { json: false, expectFail: true });
  assert(/clearance/.test(shell.stderr), 'with the clearance named');
  run('a product from the wrong species is refused', [S, 'process', 'LND-2111', '--product=TAR-FIL-C', '--cases=5'], { json: false, expectFail: true });

  run('record the harvest area clearance', [S, 'clearance', 'LND-2106', '--ref=MPI-BMSRCS-PEL2-1125']);
  const scal = run('process the scallops', [S, 'process', 'LND-2106', '--product=SCA-MEAT-C', '--cases=15', '--kg=72']);
  assert(scal.cases.length === 15 && n(scal.run.output_kg) === 72, 'fifteen cases, 72 kg');

  const snap = run('process snapper with real case weights', [S, 'process', 'LND-2111', '--product=SNA-FIL-C', '--weights=17.1,17.3,16.9,17.2,17.0,17.4,17.1,17.2,16.8,17.3,17.0,17.2,17.1,17.5,16.9']);
  assert(snap.cases.length === 15 && n(snap.run.yield_pct) === 42.8, `yield 42.8% (${snap.run.yield_pct})`);
  run('processing more fish than landed is refused', [S, 'process', 'LND-2111', '--product=SNA-FIL-C', '--cases=2', '--kg=20', '--input-kg=50'], { json: false, expectFail: true });
  const more = run('pack more output on the same run', [S, 'pack', snap.run.ref, '--product=SNA-FIL-C', '--cases=1', '--kg=4.5']);
  assert(n(more.run.output_kg) > n(snap.run.output_kg), 'the run grows');

  const runs = run('runs and yields', [S, 'runs']);
  assert(runs.runs.find((r) => r.ref === 'RUN-705').yield_gap <= -5, 'RUN-705 is under standard');

  const cases = run('cases in store', [S, 'cases']);
  assert(cases.every((c) => c.status === 'in_store'), 'only cases in store');
  const store = run('stock by product', [S, 'store']);
  assert(store.some((s) => s.product_code === 'SNA-FIL-C'), 'snapper is in stock');

  // ---- orders, allocation and dispatch gates -------------------------------------------

  const ord = run('order create', [S, 'order', 'create', '--customer=FreshCo', '--required=tomorrow']);
  assert(ord.ref === 'ORD-5105' && ord.export === false, 'a domestic order');
  run('order line', [S, 'order', 'line', 'ORD-5105', '--product=SNA-FIL-C', '--kg=150', '--price=31.50']);
  const alloc = run('allocate a run', [S, 'allocate', snap.run.ref, '--to=ORD-5105', '--count=8']);
  assert(alloc.cases.length === 8, 'eight cases allocated');
  run('a case past use-by is refused', [S, 'allocate', 'CS-30019', '--to=ORD-5105'], { json: false, expectFail: true });
  run('a product not on the order is refused', [S, 'allocate', 'CS-30097', '--to=ORD-5105'], { json: false, expectFail: true });
  const hist = run('a case over the histamine limit is refused', [S, 'allocate', 'CS-30125', '--to=ORD-5102'], { json: false, expectFail: true });
  assert(/200 mg\/kg/.test(hist.stderr), 'with the limit named');
  const d5105 = run('dispatch a domestic order', [S, 'dispatch', 'ORD-5105']);
  assert(d5105.cases === 8 && n(d5105.invoice_value) > 4000, 'invoiced at catch weight');

  const blocked = run('an export with no E-cert and untested albacore cannot dispatch', [S, 'dispatch', 'ORD-5103'], { json: false, expectFail: true });
  assert(/E-cert/.test(blocked.stderr) && /histamine/.test(blocked.stderr) && /no force flag/.test(blocked.stderr), 'both blockers named, no force flag');
  run('the E-cert reference arrives', [S, 'ecert', 'ORD-5103', '--ref=NZ-EC-2026-119207']);
  run('still blocked on histamine', [S, 'dispatch', 'ORD-5103'], { json: false, expectFail: true });
  const h = run('the histamine result arrives', [S, 'histamine', 'LND-2104', '--result=8']);
  assert(h.over_limit === false, 'under the limit');
  const d5103 = run('now it dispatches', [S, 'dispatch', 'ORD-5103']);
  assert(d5103.cases === 40, 'forty cases out');

  const trace = run('trace a dispatched case', [S, 'trace', 'CS-30060']);
  assert(trace.landing.ref === 'LND-2104' && trace.forward.some((f) => f.order_ref === 'ORD-5103' && f.ecert === 'NZ-EC-2026-119207'), 'back to the lot, forward to the order with its E-cert');
  const traceLot = run('trace a lot', [S, 'trace', 'LND-2101']);
  assert(traceLot.forward.some((f) => f.customer === 'Nelson Fish Market'), 'the snapper went to the market');

  const order = run('order card', [S, 'order', 'ORD-5102']);
  assert(order.blockers.length === 0, 'Wellington is clear to dispatch');
  run('orders --all', [S, 'orders', '--all']);
  const over = run('a high histamine result warns', [S, 'histamine', 'LND-2103', '--result=250']);
  assert(over.over_limit === true, 'flagged over the limit');
  run('and now the Wellington order cannot dispatch', [S, 'dispatch', 'ORD-5102'], { json: false, expectFail: true });
  run('correct the result (lab re-test)', [S, 'histamine', 'LND-2103', '--result=11']);

  // ---- the cold store -------------------------------------------------------------------

  const cool = run('coolstore', [S, 'coolstore']);
  assert(cool[0].room === 'Chiller 2' && cool[0].state === 'OUT OF RANGE', 'Chiller 2 is out of range');
  const t = run('a reading back in band', [S, 'temp', 'Chiller 2', '--temp=2.8', '--by=Tom']);
  assert(t.out_of_range === false, 'recorded in band');
  run('move a case', [S, 'move', 'CS-30049', '--room=Chiller 1']);
  run('write off past use-by', [S, 'writeoff', 'CS-30019', '--note=Past use-by. Binned, QA Ana.']);
  run('write off needs a reason', [S, 'writeoff', 'CS-30020'], { json: false, expectFail: true });

  // ---- paying fishers ---------------------------------------------------------------------

  const dry = run('settle dry run', [S, 'settle', 'Te Awa', '--dry-run']);
  assert(dry.dry_run && dry.lines.length === 3, 'three lots would settle');
  const set = run('settle a fisher', [S, 'settle', 'Te Awa']);
  assert(set.ref === 'SET-902' && n(set.landings) === 3, 'SET-902 covers three lots');
  run('nothing left to settle exits 1', [S, 'settle', 'Te Awa'], { json: false, expectFail: true });
  run('price on a settled lot is refused', [S, 'price', 'LND-2103', '--per-kg=20'], { json: false, expectFail: true });
  run('mark it paid', [S, 'paid', 'SET-902']);
  const sets = run('settlements', [S, 'settlements']);
  assert(sets.settlements.length === 2, 'two settlements');
  run('settlement card', [S, 'settlement', 'SET-902']);
  run('permit renewed', [S, 'permit', 'Golden Bay', '--expires=2027-11-30']);

  // ---- housekeeping -------------------------------------------------------------------------

  run('add a fisher', [S, 'add', 'fisher', 'Kaikoura Cray Ltd', '--code=KCRA', '--permit=FP-111000', '--permit-expires=2027-06-30']);
  run('add a vessel', [S, 'add', 'vessel', 'Tutu', '--fisher=KCRA', '--method=potting']);
  run('add a product', [S, 'add', 'product', 'Snapper portions, frozen', '--code=SNA-POR-F', '--species=SNA', '--storage=frozen', '--allergen=Contains fish', '--origin=Product of New Zealand']);
  run('add a customer', [S, 'add', 'customer', 'Auckland Fish Co']);
  run('log on a lot', [S, 'log', 'LND-2108', 'Rang Kath about price. 13.80 agreed.']);
  run('price a lot', [S, 'price', 'LND-2108', '--per-kg=13.80']);

  // ---- import: the first audit ----------------------------------------------------------------

  const imp = path.join(dataDir, 'import');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(imp, { recursive: true });
  writeFileSync(path.join(imp, 'vendors.csv'), 'No.,Name,Contact,Phone No.,Permit No.,Permit Expiry\r\nV0101,Cook Strait Fishing,Ian Cook,021 000 0001,FP-120001,2027-03-31\r\nV0102,"Pegasus Bay Catch, Ltd",Rae Moss,021 000 0002,,\r\n');
  writeFileSync(path.join(imp, 'vessels.csv'), 'Vessel,Vendor No.,Registration,Method\r\nAurora,V0101,NZ-70001,trawl\r\nKotare,V0102,NZ-70002,set net\r\n');
  writeFileSync(path.join(imp, 'receipts.csv'), 'Lot No.,Vessel,Species,Posting Date,Quantity,Temperature,Landing Report,Area,Trip\r\nL-88001,Aurora,TAR,2026-01-12,450,2.2,LR-1000001,038,AU-01\r\nL-88002,Kotare,SNA,2026-01-12,120,,,038,KO-01\r\nL-88003,Nowhere,SNA,2026-01-12,80,2,LR-1,038,X\r\n');
  const dryImp = run('import dry run', [S, 'import', 'aptean', `--fishers=${path.join(imp, 'vendors.csv')}`, `--vessels=${path.join(imp, 'vessels.csv')}`, `--landings=${path.join(imp, 'receipts.csv')}`, '--dry-run']);
  assert(dryImp.dry_run && dryImp.fishers === 2 && dryImp.landings === 2 && dryImp.skipped.length === 1, 'two fishers, two landings, one skipped');
  const afterDry = run('dry run wrote nothing', [S, 'stats']);
  assert(afterDry.fishers === 7, `still seven fishers (${afterDry.fishers})`);
  const realImp = run('import for real', [S, 'import', 'businesscentral', `--fishers=${path.join(imp, 'vendors.csv')}`, `--vessels=${path.join(imp, 'vessels.csv')}`, `--landings=${path.join(imp, 'receipts.csv')}`]);
  assert(realImp.landings === 2 && realImp.warnings.some((w) => /no landing report/.test(w)) && realImp.warnings.some((w) => /no permit/.test(w)), 'the import is the first audit');
  const again = run('import twice skips what is there', [S, 'import', 'csv', `--fishers=${path.join(imp, 'vendors.csv')}`]);
  assert(again.fishers === 0, 'nothing duplicated');

  const outFile = path.join(dataDir, 'export.json');
  const dump = run('export', [S, 'export', `--out=${outFile}`]);
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.cases.length === n(dump.counts.cases), 'the counts match the file');

  // ---- the branded HTML ---------------------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/processor-board\.html/.test(views.stdout) && /registers\.html/.test(views.stdout), 'both views rendered');
  const board = readFileSync(path.join(root, 'views', 'processor-board.html'), 'utf8');
  assert(board.includes('Needs a decision') && board.includes('cold store'), 'the board has its sections');
  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  for (const d of ['fisher-settlement-statement', 'dispatch-docket', 'lot-trace-report', 'cold-store-register']) assert(docsOut.stdout.includes(d), `${d} rendered`);

  // ---- the human readable side ----------------------------------------------------------------

  for (const args of [['attention'], ['week'], ['fishers', '--all'], ['fisher', 'Hawke'], ['vessels'], ['species'], ['products'], ['landings', '--all'], ['landing', 'LND-2110'], ['runs'], ['cases', '--all'], ['store'], ['trace', 'LND-2110'], ['orders', '--all'], ['order', 'ORD-5103'], ['coolstore'], ['settlements'], ['settlement', 'SET-901'], ['compliance'], ['stats']]) {
    run(`${args[0]} (text)`, [S, ...args], { json: false });
  }
  run('help', [S, 'help'], { json: false });
  run('an unknown command exits 1', [S, 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
