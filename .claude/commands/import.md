---
description: Bring the operation across from Aptean Food & Beverage ERP (Microsoft Business Central) or plain CSV: fishers, vessels, landings, customers. Dry run first, and the import is the first audit.
---

1. Read [docs/replace-aptean-food-beverage-erp.md](../../docs/replace-aptean-food-beverage-erp.md) with the operator: which lists to export from Business Central to Excel and save as CSV, what maps, what deliberately does not carry over.
2. Dry run first, always:
   ```
   npm run seafood -- import aptean --fishers=vendors.csv --vessels=vessels.csv --landings=receipts.csv --customers=customers.csv --dry-run
   ```
   Read the counts and the skips back. A skipped row is named, never silent.
3. Run it for real (drop `--dry-run`), then prove it landed: `stats`, `attention`, `compliance`.
4. **The import is the first audit.** A fisher with no permit number, a landing with no landing report or no receiving temperature, is loud the moment the import finishes. If the paperwork exists, record it; if it does not, the operator just learned what the old system never told them.
5. Column names are matched generously (No./Vendor No., Lot No./Document No., Quantity/Kg, Posting Date/Landed). If a file's headers match nothing, show the operator the first row and map it together.
