---
description: Fishers and their permits, what each landed in the last 30 days, and what is owed to each for fish not yet settled.
---

1. Run `npm run seafood -- fishers`. Expired and missing permits sort first.
2. An expired permit means that fisher's next landing is held at the door. Ring them before the boat comes in, not after. When the renewed permit arrives: `permit "<fisher>" --no= --expires=`.
3. Before a phone call with one fisher, run `fisher "<name>"`: vessels, landings, yields from their fish, what is unsettled, past settlements, the notes.
