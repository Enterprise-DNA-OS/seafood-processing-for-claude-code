---
description: A boat is in. Put the landing on the record as a raw lot, with the receiving temperature and the fisher's landing report, and the permit and temperature gates at the door.
---

1. Get the facts from the docket and the probe, never from memory: vessel, species, kg, receiving temperature, the fisher's landing report reference, trip and statistical area, bins. Ask for any that are missing.
2. Run:
   ```
   npm run seafood -- land "<vessel>" --species=<code> --kg=<kg> --temp=<C> --report=<landing report ref> --trip=<trip> --area=<stat area> [--bins= --price= --clearance=]
   ```
3. Read the result back:
   - **HELD**: the fish arrived above the species' receiving limit, or the fisher has no current permit. It is not stock. Tell the operator who decides (QA for temperature, the permit for the fisher), and that `release` needs the decision written down.
   - **Bivalve shellfish** without `--clearance` cannot be processed until the harvest area clearance is recorded.
   - **Scombroid** (tuna, kingfish): no case dispatches until a histamine result is recorded. Remind them to send the sample.
4. No temperature or no landing report means no landing. The CLI refuses; there is no override, because both are the first line of the RMP record and the LFR return.
