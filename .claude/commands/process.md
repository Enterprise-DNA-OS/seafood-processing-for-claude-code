---
description: Fish went over the line. Record the run from the lot, the cases that came off with their real net weights, and the yield against your standard.
---

1. Confirm the lot and the product: `landing <lot>` shows what is left to process and any gate in the way (held, no shellfish clearance).
2. Run with the real case weights from the scale whenever you have them. Catch weight is what the customer is invoiced:
   ```
   npm run seafood -- process <lot> --product=<code> --weights=17.1,17.3,16.9,...
   ```
   Or, when only the total is known: `--cases=<n> --kg=<total net>`. Add `--input-kg=` when only part of the lot went through, `--room=` to put the cases somewhere other than the default chiller or freezer.
3. More than one product off the same run (fillets and frames, loins and belly): `pack <run> --product= --weights=`.
4. Read back the yield. Five points or more under the species standard is flagged on the attention list: ask what happened on the line and `log <run> "..."` it while people still remember.
5. A held lot, a rejected lot or bivalves without clearance are refused. Do not look for a way around it.
