---
description: Pay the fishers. Settle a fisher's landings up to a date at the agreed price per kg less the agreed deduction, render the statement, mark it paid.
---

1. `npm run seafood -- settlements` shows past settlements and who is owed what.
2. Dry run first: `settle "<fisher>" --to=<date> --dry-run`. Read the lots and the net back to the operator.
3. Then `settle "<fisher>" --to=<date>`. It refuses while any lot has no price (agree it: `price <lot> --per-kg=`). Held fish is never included: it is not bought until decided.
4. Render the statement: `npm run docs -- fisher-settlement-statement`. A person sends it with the payment.
5. When the money goes: `paid <SET-ref>`. A paid settlement is final; prices on its lots no longer change.
