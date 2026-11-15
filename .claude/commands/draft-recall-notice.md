---
description: A lot has a problem. Trace it, list every customer who received it, and draft the notices for a person to send. Drafts only.
---

1. Trace first: `npm run seafood -- trace <lot or case>`. Read the forward table: every order, customer, destination and the kilograms.
2. Render the lot trace report for the file: `npm run docs -- lot-trace-report`.
3. Draft one notice per customer to `drafts/recall-<lot>-<customer>.md`: the product, the case numbers they received, the use-by, what to do with it, and who to call. Plain words, no speculation about cause.
4. Log the start of the recall on the lot: `log <lot> "Recall started: ..."`.
5. **Nothing sends from here.** A recall involves MPI and your RMP's recall procedure; the operator follows that procedure and sends the notices.
