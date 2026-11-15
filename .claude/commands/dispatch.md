---
description: Orders out. Create the order, add lines, allocate cases at catch weight, record the E-cert, dispatch. The export and histamine gates live here.
---

1. `npm run seafood -- orders` for the open orders; `order <ref>` for one, which lists anything blocking dispatch.
2. A new order: `order create --customer= [--export --destination= --required= --carrier=]`, then `order line <ref> --product= --kg= --price=` per product. A customer outside New Zealand is an export order automatically.
3. Allocate: `allocate <run> --to=<order> --count=<n>` or `allocate <case> --to=<order>`. Refused: cases past use-by, cases from a lot over 200 mg/kg histamine, products not on the order.
4. Export: the E-cert reference goes on with `ecert <order> --ref=` the moment it is issued.
5. `dispatch <order>`. It refuses an export order without its E-cert and any order carrying untested scombroid cases. There is no force flag. Read the blockers back and say who fixes each.
6. Render the dispatch docket and packing list: `npm run docs -- dispatch-docket`. A person sends it.
