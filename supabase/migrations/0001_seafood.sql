-- Seafood Processing for Claude Code: the schema.
--
-- A seafood processor's record, as a licensed fish receiver and an RMP
-- operator: the fishers and vessels that land to it, the species it handles,
-- every landing (one vessel, one species, one day: the raw lot), the
-- processing runs that turn a lot into product, the cases that come off the
-- line with their real net weight, the chillers and freezers, the orders and
-- dispatches, and the fisher settlements that pay for the fish.
--
-- Plain Postgres. Runs on any Postgres 13+ and on PGlite. No extensions.

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who lands fish here

create table fishers (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  contact_name text,
  phone text,
  email text,
  permit_no text,
  permit_expires_on date,
  deduction_per_kg numeric(10,2) not null default 0,  -- ice, unloading, levy recovery: the agreed per kg charge
  status text not null default 'active' check (status in ('active', 'former')),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table vessels (
  id uuid primary key default gen_random_uuid(),
  fisher_id uuid not null references fishers(id),
  name text not null,
  registration text,
  method text not null default 'trawl' check (method in ('trawl', 'longline', 'set net', 'potting', 'dredge', 'diving', 'handline', 'farm', 'other')),
  home_port text,
  status text not null default 'active' check (status in ('active', 'former')),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table species (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- the QMS code where there is one: SNA, TAR, CRA
  name text not null,
  kind text not null check (kind in ('finfish', 'crustacean', 'mollusc')),
  scombroid boolean not null default false,  -- histamine-forming: tuna, kingfish, mackerel
  bivalve boolean not null default false,    -- oysters, mussels, scallops, clams: harvest area clearance
  standard_yield_pct numeric(5,2),           -- the processor's own yield standard for its main product
  chilled_shelf_days int not null default 7,
  receive_max_c numeric(4,1) not null default 4.0,  -- your RMP's receiving limit for this species
  price_per_kg numeric(10,2),                -- default beach price paid to fishers
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fish in: the landing is the raw lot

create table landings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,                  -- LND-2101: the lot number every case traces back to
  vessel_id uuid not null references vessels(id),
  species_id uuid not null references species(id),
  landed_on date not null default current_date,
  trip_ref text,
  landing_report_ref text,                   -- the fisher's electronic landing report reference
  stat_area text,                            -- the statistical area or harvest area fished
  bins int,
  kg numeric(10,2) not null check (kg > 0),
  receive_temp_c numeric(4,1),
  shellfish_clearance_ref text,              -- bivalves: the harvest area's open-status / biotoxin clearance
  histamine_mg_kg numeric(8,2),              -- scombroid species: the test result
  histamine_tested_on date,
  price_per_kg numeric(10,2),
  status text not null default 'received' check (status in ('received', 'held', 'processed', 'rejected')),
  hold_reason text,
  settlement_id uuid,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The line: products, runs, cases

create table products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- SNA-FIL-C
  name text not null,
  species_id uuid not null references species(id),
  form text not null default 'fillet' check (form in ('whole', 'headed and gutted', 'fillet', 'portion', 'meat', 'half shell', 'live', 'other')),
  storage text not null default 'chilled' check (storage in ('chilled', 'frozen', 'live')),
  nominal_case_kg numeric(6,2),
  allergen_statement text,                   -- the declaration on the label: "Contains fish", "Contains crustacea"
  origin_statement text,                     -- country of origin on the label, NZ retail
  frozen_shelf_days int not null default 540,
  status text not null default 'active' check (status in ('active', 'former')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,                  -- RUN-701
  landing_id uuid not null references landings(id),
  run_on date not null default current_date,
  input_kg numeric(10,2) not null check (input_kg > 0),
  line text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table coolrooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null default 'chiller' check (kind in ('chiller', 'freezer', 'live tank')),
  target_min_c numeric(5,1) not null,
  target_max_c numeric(5,1) not null,
  status text not null default 'active' check (status in ('active', 'former')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table temp_checks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references coolrooms(id),
  checked_at timestamptz not null default now(),
  temp_c numeric(5,1) not null,
  checked_by text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text not null default 'New Zealand',
  contact_name text,
  email text,
  status text not null default 'active' check (status in ('active', 'former')),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,                  -- ORD-5101
  customer_id uuid not null references customers(id),
  export boolean not null default false,
  destination text,
  required_on date,
  ecert_ref text,                            -- the official assurance (E-cert) reference for an export order
  carrier text,
  status text not null default 'open' check (status in ('open', 'dispatched', 'cancelled')),
  created_on date not null default current_date,
  dispatched_on date,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  product_id uuid not null references products(id),
  kg_ordered numeric(10,2) not null check (kg_ordered > 0),
  price_per_kg numeric(10,2) not null check (price_per_kg >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique,              -- CS-30001
  run_id uuid not null references runs(id),
  product_id uuid not null references products(id),
  net_kg numeric(8,2) not null check (net_kg > 0),  -- catch weight: the real weight, invoiced as packed
  packed_on date not null default current_date,
  use_by date,
  room text,
  order_id uuid references orders(id),
  status text not null default 'in_store' check (status in ('in_store', 'dispatched', 'written_off')),
  note text,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,                  -- SET-901
  fisher_id uuid not null references fishers(id),
  period_to date not null,
  status text not null default 'draft' check (status in ('draft', 'paid')),
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table landings add constraint landings_settlement_fk foreign key (settlement_id) references settlements(id);

create table notes (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null,
  target_id uuid,
  target_label text,
  body text not null,
  noted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on vessels (fisher_id);
create index on landings (vessel_id);
create index on landings (species_id);
create index on landings (status);
create index on runs (landing_id);
create index on cases (run_id);
create index on cases (order_id);
create index on cases (status);
create index on order_lines (order_id);
create index on temp_checks (room_id, checked_at);

do $$
declare t text;
begin
  foreach t in array array['fishers','vessels','species','landings','products','runs','coolrooms','temp_checks','customers','orders','order_lines','cases','settlements','notes'] loop
    execute format('create trigger %I_updated before update on %I for each row execute function set_updated_at()', t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Views: one definition the CLI, the dashboards and the documents share

create view v_landings as
select l.id as landing_id, l.ref, l.landed_on, l.trip_ref, l.landing_report_ref, l.stat_area, l.bins, l.kg,
       l.receive_temp_c, l.shellfish_clearance_ref, l.histamine_mg_kg, l.histamine_tested_on,
       coalesce(l.price_per_kg, s.price_per_kg) as price_per_kg, l.price_per_kg is not null as price_agreed,
       l.status, l.hold_reason, l.settlement_id,
       v.id as vessel_id, v.name as vessel, v.method, f.id as fisher_id, f.name as fisher, f.code as fisher_code,
       f.permit_no, f.permit_expires_on,
       s.id as species_id, s.code as species_code, s.name as species, s.kind, s.scombroid, s.bivalve, s.receive_max_c,
       (l.receive_temp_c is not null and l.receive_temp_c > s.receive_max_c) as temp_breach,
       (f.permit_expires_on is not null and f.permit_expires_on < l.landed_on) as permit_lapsed_at_landing,
       (current_date - l.landed_on) as days_since_landing,
       coalesce((select sum(r.input_kg) from runs r where r.landing_id = l.id), 0) as kg_processed,
       coalesce((select sum(c.net_kg) from cases c join runs r on r.id = c.run_id where r.landing_id = l.id), 0) as kg_packed
from landings l
join vessels v on v.id = l.vessel_id
join fishers f on f.id = v.fisher_id
join species s on s.id = l.species_id;

create view v_runs as
select r.id as run_id, r.ref, r.run_on, r.input_kg, r.line, r.note,
       l.id as landing_id, l.ref as landing_ref, s.code as species_code, s.name as species, s.standard_yield_pct,
       f.name as fisher, v.name as vessel,
       coalesce(sum(c.net_kg), 0) as output_kg,
       count(c.id) as cases,
       round(100.0 * coalesce(sum(c.net_kg), 0) / r.input_kg, 1) as yield_pct,
       round(100.0 * coalesce(sum(c.net_kg), 0) / r.input_kg - coalesce(s.standard_yield_pct, 0), 1) as yield_gap
from runs r
join landings l on l.id = r.landing_id
join species s on s.id = l.species_id
join vessels v on v.id = l.vessel_id
join fishers f on f.id = v.fisher_id
left join cases c on c.run_id = r.id
group by r.id, l.id, s.id, f.id, v.id;

create view v_cases as
select c.id as case_id, c.case_no, c.net_kg, c.packed_on, c.use_by, c.room, c.status, c.note,
       p.id as product_id, p.code as product_code, p.name as product, p.storage,
       r.id as run_id, r.ref as run_ref,
       l.id as landing_id, l.ref as landing_ref, l.landed_on, l.stat_area, l.histamine_mg_kg,
       s.code as species_code, s.scombroid, s.bivalve,
       f.name as fisher, v.name as vessel,
       o.id as order_id, o.ref as order_ref,
       (current_date - c.packed_on) as days_in_store,
       (c.use_by - current_date) as days_to_use_by
from cases c
join products p on p.id = c.product_id
join runs r on r.id = c.run_id
join landings l on l.id = r.landing_id
join species s on s.id = l.species_id
join vessels v on v.id = l.vessel_id
join fishers f on f.id = v.fisher_id
left join orders o on o.id = c.order_id;

create view v_orders as
select o.id as order_id, o.ref, o.export, o.destination, o.required_on, o.ecert_ref, o.carrier, o.status,
       o.created_on, o.dispatched_on, cu.id as customer_id, cu.name as customer, cu.country,
       coalesce((select sum(ol.kg_ordered) from order_lines ol where ol.order_id = o.id), 0) as kg_ordered,
       coalesce((select sum(c.net_kg) from cases c where c.order_id = o.id), 0) as kg_allocated,
       (select count(*) from cases c where c.order_id = o.id) as cases,
       coalesce((select sum(c.net_kg * coalesce(ol.price_per_kg, 0))
                 from cases c left join order_lines ol on ol.order_id = o.id and ol.product_id = c.product_id
                 where c.order_id = o.id), 0) as invoice_value,
       (select count(*) from cases c join runs r on r.id = c.run_id join landings l on l.id = r.landing_id join species s on s.id = l.species_id
        where c.order_id = o.id and s.scombroid and l.histamine_mg_kg is null) as cases_untested,
       (o.required_on - current_date) as days_to_required
from orders o
join customers cu on cu.id = o.customer_id;

create view v_coolstore as
select r.id as room_id, r.name as room, r.kind, r.target_min_c, r.target_max_c,
       t.temp_c as last_temp_c, t.checked_at as last_checked_at, t.checked_by,
       extract(epoch from (now() - t.checked_at)) / 3600 as hours_since,
       (select count(*) from cases c where c.room = r.name and c.status = 'in_store') as cases_in_room,
       case
         when t.checked_at is null then 'NEVER CHECKED'
         when t.temp_c < r.target_min_c or t.temp_c > r.target_max_c then 'OUT OF RANGE'
         when now() - t.checked_at > interval '24 hours' then 'QUIET'
         else 'ok'
       end as state
from coolrooms r
left join lateral (select * from temp_checks tc where tc.room_id = r.id order by tc.checked_at desc limit 1) t on true
where r.status = 'active';

create view v_settlement_lines as
select l.landing_id, l.ref, l.landed_on, l.fisher_id, l.fisher, l.vessel, l.species_code, l.species, l.kg,
       l.price_per_kg, l.price_agreed, l.status, l.settlement_id,
       round(l.kg * coalesce(l.price_per_kg, 0), 2) as gross,
       round(l.kg * f.deduction_per_kg, 2) as deductions,
       round(l.kg * coalesce(l.price_per_kg, 0) - l.kg * f.deduction_per_kg, 2) as net
from v_landings l
join fishers f on f.id = l.fisher_id
where l.status <> 'rejected';

create view v_settlements as
select s.id as settlement_id, s.ref, s.period_to, s.status, s.paid_on, f.id as fisher_id, f.name as fisher, f.code as fisher_code,
       count(sl.landing_id) as landings, coalesce(sum(sl.kg), 0) as kg,
       coalesce(sum(sl.gross), 0) as gross, coalesce(sum(sl.deductions), 0) as deductions, coalesce(sum(sl.net), 0) as net
from settlements s
join fishers f on f.id = s.fisher_id
left join v_settlement_lines sl on sl.settlement_id = s.id
group by s.id, f.id;

create view v_fishers as
select f.id as fisher_id, f.code, f.name, f.contact_name, f.phone, f.permit_no, f.permit_expires_on, f.status, f.deduction_per_kg,
       case
         when f.permit_no is null then 'NONE'
         when f.permit_expires_on is null then 'no expiry recorded'
         when f.permit_expires_on < current_date then 'EXPIRED'
         when f.permit_expires_on < current_date + 30 then 'expiring'
         else 'current'
       end as permit,
       (select count(*) from vessels v where v.fisher_id = f.id and v.status = 'active') as vessels,
       (select count(*) from v_landings l where l.fisher_id = f.id and l.landed_on > current_date - 30) as landings_30d,
       (select coalesce(sum(l.kg), 0) from v_landings l where l.fisher_id = f.id and l.landed_on > current_date - 30) as kg_30d,
       (select coalesce(sum(sl.net), 0) from v_settlement_lines sl where sl.fisher_id = f.id and sl.settlement_id is null and sl.status in ('received', 'processed')) as owed_unsettled
from fishers f;

-- Everything that wants a decision, one row per problem.
create view v_attention as
select 'landing_held'::text as reason, l.ref as label, l.fisher as who, l.species as what, l.days_since_landing as days,
       coalesce(l.hold_reason, 'held') as detail
from v_landings l where l.status = 'held'
union all
select 'shellfish_no_clearance', l.ref, l.fisher, l.species, l.days_since_landing,
       l.kg || ' kg of bivalve shellfish with no harvest area clearance on record: it cannot be processed'
from v_landings l where l.bivalve and l.shellfish_clearance_ref is null and l.status = 'received'
union all
select 'histamine_over', l.ref, l.fisher, l.species, l.days_since_landing,
       'histamine ' || l.histamine_mg_kg || ' mg/kg, over the 200 mg/kg limit: no case from this lot can be sold'
from v_landings l where l.scombroid and l.histamine_mg_kg > 200 and l.status <> 'rejected'
union all
select 'histamine_missing', o.ref, o.customer, o.cases_untested || ' scombroid cases', o.days_to_required,
       'allocated cases from a scombroid lot with no histamine result on record: the order cannot dispatch'
from v_orders o where o.status = 'open' and o.cases_untested > 0
union all
select 'ecert_missing', o.ref, o.customer, coalesce(o.destination, 'export'), o.days_to_required,
       'export order with ' || o.cases || ' cases allocated and no E-cert reference: it cannot leave'
from v_orders o where o.status = 'open' and o.export and o.ecert_ref is null and o.cases > 0
union all
select 'coolstore_out_of_range', c.room, coalesce(c.checked_by, ''), c.cases_in_room || ' cases', null::int,
       'last reading ' || c.last_temp_c || ' C against a band of ' || c.target_min_c || ' to ' || c.target_max_c || ' C'
from v_coolstore c where c.state = 'OUT OF RANGE'
union all
select 'use_by_passed', c.run_ref, min(c.fisher), min(c.product), min(c.days_to_use_by),
       count(*) || ' cases (' || sum(c.net_kg) || ' kg) past their use-by ' || min(c.use_by) || ', still in ' || string_agg(distinct coalesce(c.room, 'store'), ', ')
from v_cases c where c.status = 'in_store' and c.use_by < current_date
group by c.run_ref
union all
select 'permit_expired', f.name, coalesce(f.contact_name, ''), coalesce(f.permit_no, 'no permit'), null::int,
       case when f.permit_no is null then 'no fishing permit on record' else 'permit expired ' || f.permit_expires_on end
from v_fishers f where f.status = 'active' and f.permit in ('EXPIRED', 'NONE')
union all
select 'order_late', o.ref, o.customer, coalesce(o.destination, ''), -o.days_to_required,
       'required ' || o.required_on || ', ' || o.kg_allocated || ' of ' || o.kg_ordered || ' kg allocated'
from v_orders o where o.status = 'open' and o.required_on < current_date
union all
select 'landing_unprocessed', l.ref, l.fisher, l.species, l.days_since_landing,
       l.kg || ' kg landed ' || l.landed_on || ' and not yet on the line'
from v_landings l where l.status = 'received' and l.days_since_landing >= 2 and l.kg_processed = 0 and not (l.bivalve and l.shellfish_clearance_ref is null)
union all
select 'yield_low', r.ref, r.fisher, r.species, (current_date - r.run_on),
       'yield ' || r.yield_pct || '% against a standard of ' || r.standard_yield_pct || '%'
from v_runs r where r.standard_yield_pct is not null and r.yield_gap <= -5 and r.run_on > current_date - 14
union all
select 'use_by_close', c.run_ref, min(c.fisher), min(c.product), min(c.days_to_use_by),
       count(*) || ' unallocated cases (' || sum(c.net_kg) || ' kg) with use-by ' || min(c.use_by) || ': sell or freeze them'
from v_cases c where c.status = 'in_store' and c.order_id is null and c.use_by between current_date and current_date + 2
group by c.run_ref
union all
select 'landing_unpriced', l.ref, l.fisher, l.species, l.days_since_landing,
       'no agreed price per kg: the fisher cannot be settled for it'
from v_landings l where l.price_per_kg is null and l.status in ('received', 'processed') and l.settlement_id is null
union all
select 'coolstore_quiet', c.room, coalesce(c.checked_by, ''), c.cases_in_room || ' cases', null::int,
       case when c.last_checked_at is null then 'never checked' else 'last checked ' || round(c.hours_since) || ' hours ago' end
from v_coolstore c where c.state in ('QUIET', 'NEVER CHECKED')
union all
select 'permit_expiring', f.name, coalesce(f.contact_name, ''), f.permit_no, (f.permit_expires_on - current_date),
       'permit expires ' || f.permit_expires_on
from v_fishers f where f.status = 'active' and f.permit = 'expiring';
