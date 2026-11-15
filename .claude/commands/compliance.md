---
description: Run the twelve rules in docs/compliance.md against the records (permits, landing reports, receiving temperature, histamine, shellfish clearance, traceability, E-certs, allergen and origin labelling, cold store, use-by, settlement) and report what is breached, with the source.
---

1. Run `npm run seafood -- compliance` (or `compliance <rule>` for one).
2. Report as a table: rule, count, the worst example, the source. Breached first.
3. For each breach, give the fix the CLI prints and who does it. Draft any letter to `drafts/`; never send.
4. If a rule in `docs/compliance.md` no longer matches the operator's RMP or the law, say so and stop. Do not guess at law. The operator confirms the rule, then you update the doc and the check in `scripts/seafood.mjs` together.

Nothing here is legal advice. The doc records the rules the operator has told the system to enforce, with sources, and this command checks the data against them.
