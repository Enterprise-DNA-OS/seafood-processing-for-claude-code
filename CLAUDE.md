# Seafood Processing for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS], a [wetfish / shellfish / rock lobster / mixed] processor and licensed fish receiver in [port, New Zealand]
- **Operator:** [YOUR NAME], [owner / plant manager / QA manager / office manager]
- **The fishers:** [roughly who: how many land to you, which boats are the big ones, who rings about price]
- **The markets:** [domestic wholesale and retail, which export markets, which ones need what paperwork]
- **Who makes the QA call on held fish:** [name them now: when fish arrives warm, a histamine result comes back high, or a lot has no clearance, whose decision is it]
- **What matters most:** [for example: no export ever late on its E-cert, no scombroid case ever out untested, fishers settled every Friday]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a lot, an order or a fisher, read its card first: `landing <lot>`, `order <ref>`, `fisher <name>`.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The industry's words, not software words: a landing, a lot, a run, a case, catch weight, yield, a chiller, an E-cert, a histamine result, a harvest area clearance, a settlement.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or goes to a fisher, a customer, MPI or FishServe waits for a yes in this session.
6. **Never invent a fact.** Weights, temperatures, histamine results, permit dates, clearance references and prices come from the docket, the probe, the lab report, the permit or the agreement. If a fact is missing, ask for that one fact.
7. **Never rule on food safety.** This system records the readings and enforces the gates. Whether held fish is fit to sell is QA's call, never yours.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs a decision today | `/attention` |
| A boat is in | `/land` |
| Held fish: what do we do | decide, `log`, then `release <lot> --note=` or `reject <lot> --note=` |
| Fish went over the line | `/process` (more products off the same run: `pack <run>`) |
| How did the line do | `/yields` |
| What is in the chillers and freezers | `/store` |
| Where did this case come from, where did this lot go | `/trace` |
| Room temps, a check to record | `/coolstore`, `temp <room> --temp=` |
| A histamine result came back | `/histamine` |
| The shellfish clearance arrived | `/shellfish` |
| An order: create, allocate, E-cert, dispatch | `/dispatch` |
| A fisher is on the phone | `fisher <name>` first, then talk |
| Permits | `/fishers`; a renewal: `permit <fisher> --no= --expires=` |
| Pay the fishers | `/settle` |
| The week on one screen | `/week` |
| The Monday review | `/weekly-review` |
| Are we compliant, what would the verifier find | `/compliance` |
| The fisher's statement | `/draft-settlement-statement` |
| The docket and packing list | `/draft-dispatch-docket` |
| A lot has a problem, who got it | `/draft-recall-notice` |
| I spoke to them, note the file | `/log` |
| Bring us over from Aptean / Business Central | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run seafood -- help`) and then propose a new command for it.

## Hard rules

- **Fish from a fisher with no current permit is held, never received as stock.** A licensed fish receiver buys only from a permit holder. `release` refuses until a permit covering the landing date is on record.
- **Fish received above the species' receiving limit is held.** No landing goes on the record without its receiving temperature and the fisher's landing report reference.
- **Bivalve shellfish never goes on the line without its harvest area clearance.** `process` refuses; there is no override.
- **No case from a scombroid lot dispatches without a histamine result, and no case from a lot over 200 mg/kg is ever allocated or dispatched.**
- **No export order dispatches without its E-cert reference.** There is no force flag.
- **Nothing here connects to MPI, FishServe, a fisher or a customer, and nothing sends.** Documents render to `docs-out/`, drafts to `drafts/`; a person sends.
- **Never delete records.** Landings are rejected, cases written off, orders cancelled, all with the reason and their history intact. The traceability record is the business's memory and, in a recall, its defence.
- **Never invent a record.** If a name or a reference is ambiguous, list the candidates and ask. The CLI already does this.
- The database is the source of truth. If the answer is not in it, say so.

## Words this business uses

- A **landing** is one vessel's catch of one species on one day. It is the **lot**: every case traces back to it. It is `received`, `held`, `processed` or `rejected`.
- The **landing report** is the fisher's electronic report of what they landed. A licensed fish receiver's records reconcile against it.
- The **receiving limit** is the temperature your RMP sets for fish at the door, per species.
- A **run** is a lot (or part of one) going over the line. **Yield** is kilograms packed over kilograms in, against your own **standard** per species.
- A **case** carries its real net weight: **catch weight**. Customers are invoiced on it, not on the nominal case size.
- **Scombroid** species (tuna, kingfish, mackerel) form histamine when temperature control slips. The Food Standards Code limit is 200 mg/kg.
- **Bivalve** shellfish (oysters, mussels, scallops, clams) are only harvested from an area open under MPI's shellfish programme; the **harvest area clearance** is the proof.
- An **E-cert** is the official assurance reference an export consignment travels under.
- A **settlement** pays a fisher for their lots: kilograms at the agreed price per kg, less the agreed per kg **deduction**.

## Where things live

- `scripts/seafood.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-aptean-food-beverage-erp.md` moving off the incumbent. `docs/why-no-front-end.md` the honest trade-offs.
- `exports/` whole database dumps. `drafts/` and `docs-out/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/aptean-food-beverage-erp
