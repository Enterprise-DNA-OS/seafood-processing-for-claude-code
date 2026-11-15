---
description: Everything that wants a decision this morning, worst first. Held landings, histamine, shellfish without clearance, exports blocked on an E-cert, the cold store, use-by dates, permits, yields and fish waiting for the line.
---

1. Run `npm run seafood -- attention`.
2. The list is already ordered by what each item can cost. Read it in that order and do not reorder it by ease:
   - **Held at the door** outranks everything. Fish received warm, or from a fisher with no current permit, is not stock. The decision is QA's (recheck, sensory, reject) or the permit holder's (renewed permit that covered the landing date). Log it, then `release <lot> --note=` or `reject <lot> --note=`.
   - **Histamine over the limit** is a lot that cannot be sold. Quarantine its cases (`move` to the hold room), decide, `writeoff` each with the reason.
   - **Shellfish with no area clearance** cannot go on the line. Get the harvest area clearance from the fisher today: `clearance <lot> --ref=`.
   - **No histamine result** and **no E-cert** each stop an order leaving. Name the order, the customer and the flight. Chase the lab, chase the certificate.
   - **Cold store out of range** with fish inside is a same-day decision: fix the plant, move the product, record the corrective action with `log`.
   - **Past use-by, permits, late orders, fish waiting, low yields, near use-by, quiet rooms** are condition and money leaking quietly.
3. For each item, say the one action: the command to run, the person to ring, or the decision to make. Name who.
4. Anything that needs paper is drafted, never sent: `npm run docs`, a person sends.

If the operator asks "what should I do today", pick the top three and say why those three.
