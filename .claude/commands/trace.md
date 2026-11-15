---
description: Any case or lot, one step back (vessel, fisher, permit, trip, area, landing report, temperature, histamine) and one step forward (every order and customer it went to). The recall answer in seconds.
---

1. Run `npm run seafood -- trace <case or lot>` (`CS-30060`, `LND-2104`, or just the number).
2. Present one step back first, then the forward table. The forward table is the list of who to ring in a recall: order, customer, destination, E-cert, cases and kilograms.
3. If the operator is preparing for a recall or a mock recall, render the paperwork too: `npm run docs -- lot-trace-report`. Time how long it took; an RMP verifier will ask.
4. Never contact a customer from here. Draft the notice to `drafts/` if asked; a person sends.
