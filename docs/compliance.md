# The rule book

`/compliance` (and `npm run seafood -- compliance`) runs every rule below against the records and reports what is breached. Each rule names its source, what a breach looks like in the data, and how the CLI enforces it. Change a rule here and in `RULES` in `scripts/seafood.mjs` together.

Nothing here is legal advice. These are the rules a New Zealand seafood processor operating as a licensed fish receiver under a Risk Management Programme typically works to. Your RMP, your verifier and your export markets decide the exact limits; set them to match.

| # | Rule | Source | A breach in the data | Enforced at the gate |
|---|---|---|---|---|
| 1 | Fish bought only from a current permit holder | Fisheries Act 1996: licensed fish receivers acquire fish only from permit holders | A received or processed landing whose fisher had no permit, or an expired one, on the landing date | `land` holds it; `release` refuses until a permit covering the date is recorded |
| 2 | Every landing carries the fisher's landing report reference | Fisheries (Reporting) Regulations 2017, electronic catch and landing reporting | A landing with no landing report reference | `land` refuses without `--report` |
| 3 | Fish above its receiving limit is decided inside 24 hours; every landing has a receiving temperature | Animal Products Act 1999; your RMP's receiving critical limit | A landing held for temperature a day or more, or with no temperature | `land` holds warm fish and refuses a landing without `--temp` |
| 4 | Scombroid fish is tested, and never sold above 200 mg/kg histamine | Australia New Zealand Food Standards Code, Schedule 19 (maximum level of histamine in fish and fish products); your RMP's histamine controls | Allocated or dispatched cases from a scombroid lot with no result; cases from a lot over 200 mg/kg not written off | `allocate` refuses over-limit cases; `dispatch` refuses untested or over-limit cases |
| 5 | Bivalve shellfish carries its harvest area clearance | MPI Animal Products Notice: Regulated Control Scheme, Bivalve Molluscan Shellfish for Human Consumption | A received or processed bivalve lot with no clearance reference | `process` refuses |
| 6 | Every lot records where it was caught and on which trip | Animal Products Act 1999 and your RMP's traceability and recall procedures | A landing with no statistical area or trip | the trace and the dispatch docket print the gap |
| 7 | No export leaves without its E-cert reference | Animal Products Act 1999 (exports) and MPI official assurance requirements for the market | A dispatched export order with no E-cert, or one due inside two days with cases allocated and none | `dispatch` refuses; there is no force flag |
| 8 | Every product declares fish, crustacea or mollusc | Australia New Zealand Food Standards Code, Standard 1.2.3 (mandatory declarations) | An active product specification with no allergen statement | `add product` warns |
| 9 | Fresh and frozen seafood for New Zealand retail states its country of origin | Consumer Information Standards (Origin of Food) Regulations 2021 | An active product specification with no origin statement | |
| 10 | Every chiller and freezer checked inside 24 hours and inside its band | Your RMP's temperature monitoring procedure; the bands are yours | A room out of range, or not checked for a day | `temp` flags an out-of-range reading the moment it is recorded |
| 11 | No case sits in store past its use-by | Australia New Zealand Food Standards Code, Standard 1.2.5 (date marking); your shelf life validation | A case in store after its use-by | `allocate` refuses it |
| 12 | Fishers settled inside 14 days of landing | Your supply agreement (change the 14 days to yours) | An unsettled, unheld lot older than 14 days | `settle` refuses while any lot in the period has no price |

## What this does not do

- It does not file your licensed fish receiver returns, talk to FishServe, or check a fisher's ACE balance. It keeps the record those returns reconcile against.
- It does not request E-certs or connect to MPI's systems. It records the reference and refuses to dispatch without it.
- It does not decide whether fish is safe. It records the reading or the result, enforces the limit, and puts the decision in front of the person named in `CLAUDE.md`.
- Australian processors work under different instruments (state food authorities, the Export Control Act 2020 and the Export Control (Fish and Fish Products) Rules 2021). The Food Standards Code rules (4, 8, 11) apply on both sides of the Tasman; ask `/customise` to swap the others for yours.
