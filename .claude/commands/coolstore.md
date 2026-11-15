---
description: Every chiller, freezer and live tank, its band, its last reading and who took it. Record a check. The RMP temperature record.
---

1. Run `npm run seafood -- coolstore`.
2. **OUT OF RANGE** with product inside is a same-day decision: what is the plant doing, does the product move, what did you do. Record the reading with `temp "<room>" --temp= --by=`, and the corrective action with `log "<room>" "..."`.
3. **QUIET** or **NEVER CHECKED** is a gap in the record. Ask for a reading now.
4. For the verifier or the auditor: `npm run docs -- cold-store-register` renders the last 14 days per room in your brand.
