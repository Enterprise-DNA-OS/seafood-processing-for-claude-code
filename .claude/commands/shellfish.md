---
description: Bivalve shellfish (oysters, mussels, scallops, clams) and their harvest area clearance. Nothing goes on the line without it.
---

1. Run `npm run seafood -- attention` and look for "Shellfish with no area clearance", or `landings --species=SCA --all`.
2. The clearance comes from the harvester and the area's status under the bivalve shellfish regulated control scheme: the area was open on the harvest date and any biotoxin clearance is in place. Record it with `clearance <lot> --ref=`.
3. Until it is recorded, `process` refuses the lot. Do not suggest a workaround. If the area was closed on the harvest date, the lot is rejected: `reject <lot> --note=`.
