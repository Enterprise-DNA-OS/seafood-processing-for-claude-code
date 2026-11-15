# Moving off Aptean Food & Beverage ERP

Aptean's meat and seafood ERP runs on Microsoft Business Central. Every list in Business Central has **Open in Excel** (or **Export to Excel**) on the page's share menu, so the history comes out as spreadsheets you save as CSV. Your Aptean partner can also run the export for you.

## 1. Export these lists

| Business Central list | Save as | What it becomes here |
|---|---|---|
| Vendors (filtered to your fishers) | `vendors.csv` | fishers |
| Your vessel list (a custom table, a vendor field, or a spreadsheet you already keep) | `vessels.csv` | vessels |
| Posted purchase receipts, or item ledger entries filtered to purchases, with lot numbers | `receipts.csv` | landings, one per lot |
| Customers | `customers.csv` | customers |

## 2. Run the import, dry run first

```bash
npm run seafood -- import aptean --fishers=vendors.csv --vessels=vessels.csv --landings=receipts.csv --customers=customers.csv --dry-run
npm run seafood -- import aptean --fishers=vendors.csv --vessels=vessels.csv --landings=receipts.csv --customers=customers.csv
```

The dry run writes nothing and names every row it would skip. Running the import twice does not duplicate: fishers match on name or vendor number, landings on lot number.

## What maps

| Here | Business Central column names it recognises |
|---|---|
| fisher code, name | `No.`, `Name` (or `Vendor Name`, `Fisher`, `Supplier`) |
| contact, phone, email | `Contact`, `Phone No.`, `E-Mail` |
| permit number and expiry | `Permit No.`, `Permit Expiry` (add these columns if your permits live elsewhere) |
| vessel | `Vessel`, `Vendor No.` (or `Fisher`), `Registration`, `Method`, `Home Port` |
| landing (the lot) | `Lot No.` (or `Document No.`), `Vessel`, `Species` (or `Item No.`), `Posting Date`, `Quantity` (kg), `Temperature`, `Landing Report`, `Area`, `Trip`, `Unit Cost` |
| customer | `No.`, `Name`, `Country/Region Code` (`AU` becomes Australia), `Contact`, `E-Mail` |

Species are matched on their code (`SNA`, `TAR`) or name. Add your species and product specifications first (`add species`, `add product`), or ask `/customise` to load them from your item list.

## What deliberately does not carry over

- **Open stock by case.** Count the chillers and freezers on cut-over day and pack the opening stock in as runs from an opening lot per species. Old item ledger quantities are not catch-weight cases with a lot behind them.
- **Posted invoices and the general ledger.** They stay in your accounting system. This holds the operational record: what came in, what it became, where it went, what each fisher is owed.
- **Production BOMs and routings.** A run here is a lot in, cases out. Your yields are measured, not planned.
- **Scale and label printer integrations.** Enterprise DNA connects those in the version we build for you.

## The import is the first audit

A fisher imported with no permit number, a landing with no landing report reference or no receiving temperature, are named the moment the import finishes. Run `attention` and `compliance` straight after. If the paperwork exists, record it; if it does not, you just learned what the old system never told you.
