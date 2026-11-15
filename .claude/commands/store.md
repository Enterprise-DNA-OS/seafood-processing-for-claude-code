---
description: What is in the chillers and freezers, by product and by case, nearest use-by first, and what is not yet on an order.
---

1. Run `npm run seafood -- store` for the summary by product, then `cases --unallocated` for the free stock, nearest use-by first.
2. Chilled product inside two days of its use-by and not on an order is the first thing to sell or freeze: name it, with the kilograms.
3. Anything past its use-by is written off, never allocated: `writeoff <case> --note=`.
4. Filters: `cases --room="Chiller 2"`, `cases --product=SNA-FIL-C`, `cases --order=ORD-5103`. Move a case with `move <case> --room=`.
