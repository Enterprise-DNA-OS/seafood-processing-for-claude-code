# Why there is no front end

Aptean Food & Beverage ERP is a database with a licence. The tables underneath it are ordinary: fishers, landings and lots, runs, cases with their weights, orders, settlements. What you pay for is the layer on top that lets people who do not write SQL get at those tables. Screens, filters, dashboards, forms, and the partner who configures them.

That layer used to be the whole product, because talking to a database was hard. It is not hard any more. Open this folder in Claude Code, describe what you want, and it writes the query, runs it, and explains the answer. Ask a question the ERP never had a screen for ("which vessel's fish yields lowest on the fillet line?") and you still get an answer.

## What you gain

- **Better answers.** A screen shows what the vendor decided to show. Here you ask your own question, in your own words, against your own records.
- **No licences per user.** The QA manager, the dispatch clerk and the owner all look at the same record. The bill does not grow with headcount.
- **Your data in your Postgres.** Plain tables. Back them up, query them from anything, leave any time.
- **Gates that match your RMP.** The permit, temperature, shellfish, histamine and E-cert gates are a few lines each. When your RMP changes, you change the rule in plain language.

## What you give up, and what Enterprise DNA builds for it

- **A screen on the processing floor.** Weights here come from the scale's export or are typed in. Enterprise DNA connects your scales and label printers in the version we build for you.
- **A tablet at the receiving door.** Landings are entered through Claude Code. A simple receiving form is part of the customised version.
- **Offline.** It runs where your database is reachable.
- **A vendor help desk.** This is open source. Enterprise DNA supports the installed version for businesses that want someone to call.

## Who this fits

Processors who want the record and the answers more than the screens: the owner who asks the questions, the QA manager who needs the gates to hold, and the office that settles the fishers. If your floor needs a screen all day, Enterprise DNA builds one on the same database.

Installed and run for you: https://enterprisedna.co/omni/instead-of/aptean-food-beverage-erp
