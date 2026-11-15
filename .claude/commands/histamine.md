---
description: Scombroid lots (tuna, kingfish, mackerel) and their histamine results. Record a result; see which orders are waiting on one; quarantine a lot over 200 mg/kg.
---

1. Run `npm run seafood -- landings --species=ALB --all` (or KIN) to see each scombroid lot and its result, and `attention` for the orders blocked on one.
2. Record a lab result: `histamine <lot> --result=<mg/kg> [--on=<date>]`. Take the number from the lab report, never from a phone call summary.
3. Over 200 mg/kg (Food Standards Code, Schedule 19): no case from that lot can be allocated or dispatched. Move its cases to the hold room (`move <case> --room="Hold cage"`), log the decision, and `writeoff` each case with the reason once the decision is made.
4. Never rule on whether a lot is safe. The system records the result and enforces the limit; the decision on the fish is QA's.
