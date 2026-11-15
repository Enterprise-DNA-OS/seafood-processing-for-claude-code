<h1 align="center">Seafood Processing for Claude Code</h1>

<p align="center">
  <strong>The open-source seafood processing system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Aptean Food & Beverage ERP data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=aptean-food-beverage-erp">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/aptean-food-beverage-erp?utm_source=github&utm_medium=readme&utm_campaign=aptean-food-beverage-erp">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-aptean-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-aptean-food-beverage-erp">Instead of Aptean Food & Beverage ERP</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Seafood Processing for Claude Code does the job a seafood processor buys Aptean Food & Beverage ERP (or a Business Central, NetSuite or seafood ERP partner build) for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and run the plant in plain language. It runs the right query, and it answers questions the ERP's screens were never built for.

Aptean publishes no price for its meat and seafood ERP. It is sold as Microsoft Business Central with Aptean's food modules on top (catch weight, lot traceability, grades and cuts, label management), quoted per business and installed as an implementation project, with separately sold add-ons for quality, maintenance, transport and reporting. What a processor actually needs to hold is ordinary: the fishers and vessels landing to it, every landing as a lot, the runs that turn a lot into product, the cases off the line with their real weight, the chillers and freezers, the orders going out, and the money going back to fishers. That is fourteen Postgres tables.

This repo is that record over Postgres, with the asking done by the agent you already have:

```
/attention                 everything that wants a decision this morning, worst first
/land                      a boat is in: the landing as a lot, with the permit and temperature gates at the door
/process                   fish over the line: cases at their real weight, and the yield
/yields                    yield by run and by species against your own standard
/store                     chillers and freezers, nearest use-by first
/trace                     any case or lot, one step back and one step forward, in seconds
/dispatch                  orders out at catch weight, with the E-cert and histamine gates built in
/histamine                 scombroid lots and their results, and the 200 mg/kg limit
/shellfish                 bivalves and their harvest area clearance
/coolstore                 every room, its band, its last reading: the RMP temperature record
/settle                    pay the fishers: lots at their price, less the deduction
/compliance                twelve rules from the Acts, the Food Standards Code and your RMP
/weekly-review             the Monday review, written from three commands
```

The sharp edges are deliberate, because in this industry soft edges cost market access and make people sick:

- **Fish from a fisher with no current permit is held, not received.** A licensed fish receiver buys only from a permit holder. Releasing the hold is refused until a permit that covered the landing date is on record.
- **Fish received above its receiving limit is held.** No temperature, no landing: the CLI refuses a landing without the probe reading or the fisher's landing report reference.
- **Bivalve shellfish cannot go on the line without its harvest area clearance.** There is no override.
- **No case from a scombroid lot (tuna, kingfish) dispatches without a histamine result, and never above 200 mg/kg.** Cases from an over-limit lot cannot even be allocated.
- **An export order cannot dispatch without its E-cert reference.** There is no force flag.
- **Cases are invoiced at catch weight.** Every case carries its real net weight from the scale, and the order's value is the sum of those weights at the line price.

**Nothing here connects to MPI, FishServe or a customer, and nothing sends.** Statements, dockets and registers render to files in your brand; a person sends them. Nothing here is legal advice.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your landings, lots and cases sit in plain Postgres tables you own. Any tool can read them. No export request, no access ending when a subscription does.
- No per-user licences, no modules, no implementation project. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/seafood-processing-for-claude-code.git
cd seafood-processing-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Tasman Bay Seafoods (a demo Nelson processor with six fishers landing to it and a fortnight going slightly wrong: rock lobster held because the fisher's permit lapsed, gurnard held after arriving at 6.8 C, scallops landed with no harvest area clearance, albacore loins allocated to a Japan order with no histamine result and no E-cert, a kingfish lot that tested 240 mg/kg and sits quarantined, a tarakihi run seven points under its yield standard, Chiller 2 reading 6.5 C with fish inside, and snapper cases past their use-by), then prints the attention list, the week and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/yields`, `/store`, `trace CS-30060`, `fisher "Te Awa"`, `order ORD-5103`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md), especially who makes the QA call on held fish, and put your name and colours in [brand.json](brand.json) so every statement and docket carries them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. Each person clones the repo, points at the same `DATABASE_URL`, and works in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: held fish and food safety outrank all. |
| `/land` | A boat is in: the landing as a lot, with the permit and receiving temperature gates at the door. |
| `/process` | A lot through the line: cases at their real net weight, the run's yield against standard. |
| `/yields` | Yield by run and by species, with the gap in kilograms. |
| `/store` | Stock on hand by product and by case, nearest use-by first, free stock flagged. |
| `/trace` | Any case or lot one step back (vessel, permit, trip, area, temperature, histamine) and one step forward (every customer). |
| `/dispatch` | Orders, lines, allocation at catch weight, the E-cert, dispatch. The export gates live here. |
| `/histamine` | Scombroid lots, their results, and what the 200 mg/kg limit blocks. |
| `/shellfish` | Bivalve lots and their harvest area clearance. |
| `/coolstore` | Every chiller, freezer and live tank, its band, its last reading. |
| `/fishers` | Fishers, their permits, what they landed and what they are owed. |
| `/settle` | Settle a fisher's lots at the agreed price less the deduction; mark it paid. |
| `/week` | The last seven days on one screen. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Twelve rules from the Acts, the Food Standards Code and your RMP, run against your records, sources cited. |
| `/draft-settlement-statement` | The statement a fisher gets with the payment. Drafts only. |
| `/draft-dispatch-docket` | The docket and packing list: every case with its weight, lot, vessel and area. Drafts only. |
| `/draft-recall-notice` | Trace a lot and draft a notice per customer who received it. Drafts only. |
| `/log` | A call, a decision, a corrective action, onto the record the moment it happens. |
| `/import` | Bring the operation across from Aptean (Business Central) or plain CSV. The import is the first audit. |
| `/customise` | Add a field, change a rule, rename things, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run seafood -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # fisher settlement statements, dispatch dockets, lot trace reports, cold store registers
npm run view    # the processor board and the registers, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your business name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached, each rule citing its source. The CLI enforces the sharpest ones at the gate.

1. Fish bought only from a current permit holder (Fisheries Act 1996).
2. Every landing carries the fisher's landing report reference (Fisheries (Reporting) Regulations 2017).
3. Fish above its receiving limit decided inside 24 hours; every landing has a receiving temperature (Animal Products Act 1999, your RMP).
4. Scombroid fish tested, never sold above 200 mg/kg histamine (Food Standards Code, Schedule 19).
5. Bivalve shellfish carries its harvest area clearance (MPI bivalve molluscan shellfish regulated control scheme).
6. Every lot records where it was caught and on which trip (your RMP traceability procedures).
7. No export leaves without its E-cert reference (Animal Products Act 1999, MPI official assurance).
8. Every product declares fish, crustacea or mollusc (Food Standards Code, Standard 1.2.3).
9. Fresh and frozen seafood states its country of origin (Consumer Information Standards (Origin of Food) Regulations 2021).
10. Every chiller and freezer checked inside 24 hours and inside its band (your RMP).
11. No case in store past its use-by (Food Standards Code, Standard 1.2.5).
12. Fishers settled inside 14 days of landing (your supply agreement; change the number).

Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your RMP.

## Ten questions Aptean cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Is there fish on the floor right now that we have not legally bought, because the fisher's permit had lapsed on the landing date?
2. Which orders cannot leave today, and is it the E-cert, the histamine result, or both?
3. Which vessel's fish yields lowest on the fillet line, run over run, and what did that cost us in kilograms?
4. If this case number came back in a recall, which boat, trip and area did it come from, and who else received fish from the same lot?
5. Which chilled cases are inside two days of their use-by and not yet on an order, by kilograms?
6. What do we owe each fisher right now for fish we have not settled, and which lots have no agreed price?
7. Which cold room went out of range this fortnight, with how many cases inside, and what did we do about it?
8. Which product specifications are missing an allergen or country of origin statement?
9. Which scombroid lots have been sold or allocated without a histamine result on record?
10. What did each customer actually pay per kilogram once catch weight is counted, against the price on the order?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your plant.

1. "Put our fishers and vessels in, with their real permit numbers and expiry dates."
2. "Put our logo and colours on the statements and the dockets, and change the business name to ours."
3. "Our receiving limit for chilled finfish is 5 C, and 15 C for live crayfish. Change it."
4. "Add a sensory score to every landing, and hold anything that scores under 6."
5. "Import our Business Central vendor list and purchase receipts, then show me what the old system never told us."
6. "Add a compliance rule: no export to the EU without a catch certificate reference."
7. "Track frames and heads as a by-product off each run, so the yield includes them."
8. "Build a page per fisher: their landings, yields, settlements and permit."
9. "When I dispatch an export order, render the docket in the same breath."
10. "Write a command that drafts the weekly price list for our fishers from the species beach prices."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of Aptean Food & Beverage ERP

Export your vendors (fishers), vessels, purchase receipts and lots, and customers from Business Central to Excel, save them as CSV, run one command, and the record comes with you. Step by step, with what maps and what deliberately does not carry over: [docs/replace-aptean-food-beverage-erp.md](docs/replace-aptean-food-beverage-erp.md).

```bash
npm run seafood -- import aptean --fishers=vendors.csv --vessels=vessels.csv --landings=receipts.csv --customers=customers.csv --dry-run
npm run seafood -- import aptean --fishers=vendors.csv --vessels=vessels.csv --landings=receipts.csv --customers=customers.csv
```

The import is the first audit: a fisher with no permit number, or a landing with no landing report or receiving temperature, is loud the moment the import finishes.

## Architecture

```
seafood-processing-for-claude-code/
  CLAUDE.md                 how the business wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your name, logo and colours on every statement and docket
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/seafood.mjs       the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-aptean-food-beverage-erp.md   moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  whole database dumps
  drafts/                   anything written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, no MPI or FishServe credentials, nothing that sends, and the permit, temperature, shellfish, histamine and E-cert gates stay.

## Want it installed and run for you?

Enterprise DNA installs Seafood Processing for Claude Code for your business, migrates your Aptean data, writes your species, products and rituals in as commands, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=aptean-food-beverage-erp)
- Read more: [enterprisedna.co/omni/instead-of/aptean-food-beverage-erp](https://enterprisedna.co/omni/instead-of/aptean-food-beverage-erp?utm_source=github&utm_medium=readme&utm_campaign=aptean-food-beverage-erp)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
