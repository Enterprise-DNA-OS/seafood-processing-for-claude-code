-- Demo data: Tasman Bay Seafoods, a demo Nelson processor and licensed fish
-- receiver with six fishers landing to it and a fortnight going slightly
-- wrong. Every date is relative to today, so the demo is always live.
--
--   * rock lobster held at the door: the fisher's permit lapsed
--   * gurnard held: it arrived at 6.8 C against a 4 C receiving limit
--   * scallops landed with no harvest area clearance, so they cannot be processed
--   * albacore loins allocated to a Japan order with no histamine result and no E-cert
--   * a kingfish lot that tested 240 mg/kg histamine, frozen and quarantined
--   * a tarakihi run that yielded seven points under standard
--   * Chiller 2 reading 6.5 C with fish in it, the live tank not checked for 30 hours
--   * snapper cases past their use-by, kingfish cases two days from theirs
--
-- Idempotent: a second run does nothing.

do $$
declare
  d date := current_date;
  f_hawk uuid; f_teaw uuid; f_gbpc uuid; f_mssf uuid; f_albt uuid; f_rowe uuid;
  v_sanm uuid; v_kait uuid; v_rewa uuid; v_pelo uuid; v_sthx uuid; v_mrose uuid;
  s_sna uuid; s_tar uuid; s_gur uuid; s_kin uuid; s_alb uuid; s_cra uuid; s_sca uuid;
  p_snaf uuid; p_tarf uuid; p_gurw uuid; p_kinc uuid; p_kinf uuid; p_albf uuid; p_cral uuid; p_scam uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; l7 uuid; l8 uuid; l9 uuid; l10 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid;
  c_nfm uuid; c_wrs uuid; c_kaiyo uuid; c_syd uuid; c_fresh uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid;
  set1 uuid;
  rm_c1 uuid; rm_c2 uuid; rm_f1 uuid; rm_lt uuid; rm_hc uuid;
  n int := 30000;
  i int;
begin
  if exists (select 1 from fishers where code = 'HAWK') then
    return;
  end if;

  -- Fishers and vessels ------------------------------------------------------
  insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, deduction_per_kg)
    values ('HAWK', 'Hawke Fishing Ltd', 'Dave Hawke', '021 555 0141', 'dave@hawkefishing.example', 'FP-104471', d + 240, 0.35) returning id into f_hawk;
  insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, deduction_per_kg)
    values ('TEAW', 'Te Awa Moana Fisheries', 'Mere Tipene', '027 555 0198', 'mere@teawamoana.example', 'FP-108812', d + 300, 0.30) returning id into f_teaw;
  insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, deduction_per_kg)
    values ('GBPC', 'Golden Bay Potting Co', 'Sam Ruru', '021 555 0177', 'sam@gbpotting.example', 'FP-099314', d - 11, 0.30) returning id into f_gbpc;
  insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, deduction_per_kg)
    values ('MSSF', 'Marlborough Sounds Shellfish', 'Anna Clarke', '027 555 0103', 'anna@mssf.example', 'FP-102256', d + 20, 0.25) returning id into f_mssf;
  insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, deduction_per_kg)
    values ('ALBT', 'Albacore Troll Ltd', 'Pete Vance', '021 555 0122', 'pete@albacoretroll.example', 'FP-110093', d + 410, 0.30) returning id into f_albt;
  insert into fishers (code, name, contact_name, phone, email, permit_no, permit_expires_on, deduction_per_kg)
    values ('ROWE', 'D & K Rowe', 'Kath Rowe', '027 555 0160', 'kath@rowefishing.example', 'FP-097745', d + 150, 0.40) returning id into f_rowe;

  insert into vessels (fisher_id, name, registration, method, home_port) values (f_hawk, 'San Marino', 'NZ-63102', 'trawl', 'Nelson') returning id into v_sanm;
  insert into vessels (fisher_id, name, registration, method, home_port) values (f_teaw, 'Kaitiaki', 'NZ-64877', 'longline', 'Nelson') returning id into v_kait;
  insert into vessels (fisher_id, name, registration, method, home_port) values (f_gbpc, 'Rewa', 'NZ-61290', 'potting', 'Tarakohe') returning id into v_rewa;
  insert into vessels (fisher_id, name, registration, method, home_port) values (f_mssf, 'Pelorus Dredge', 'NZ-62014', 'dredge', 'Havelock') returning id into v_pelo;
  insert into vessels (fisher_id, name, registration, method, home_port) values (f_albt, 'Southern Cross', 'NZ-65530', 'handline', 'Nelson') returning id into v_sthx;
  insert into vessels (fisher_id, name, registration, method, home_port) values (f_rowe, 'Moana Rose', 'NZ-60418', 'set net', 'Motueka') returning id into v_mrose;

  -- Species --------------------------------------------------------------------
  insert into species (code, name, kind, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ('SNA', 'Snapper', 'finfish', 42, 7, 4.0, 14.50) returning id into s_sna;
  insert into species (code, name, kind, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ('TAR', 'Tarakihi', 'finfish', 40, 7, 4.0, 9.80) returning id into s_tar;
  insert into species (code, name, kind, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ('GUR', 'Red gurnard', 'finfish', 90, 6, 4.0, 6.20) returning id into s_gur;
  insert into species (code, name, kind, scombroid, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ('KIN', 'Kingfish', 'finfish', true, 48, 7, 4.0, 16.00) returning id into s_kin;
  insert into species (code, name, kind, scombroid, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ('ALB', 'Albacore tuna', 'finfish', true, 55, 6, 4.0, 7.40) returning id into s_alb;
  insert into species (code, name, kind, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ('CRA', 'Rock lobster', 'crustacean', null, 3, 15.0, 72.00) returning id into s_cra;
  insert into species (code, name, kind, bivalve, standard_yield_pct, chilled_shelf_days, receive_max_c, price_per_kg) values ('SCA', 'Scallop', 'mollusc', true, 14, 5, 5.0, 8.50) returning id into s_sca;

  -- Products -------------------------------------------------------------------
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('SNA-FIL-C', 'Snapper fillets, skin on, chilled', s_sna, 'fillet', 'chilled', 10, 'Contains fish', 'Product of New Zealand') returning id into p_snaf;
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('TAR-FIL-C', 'Tarakihi fillets, chilled', s_tar, 'fillet', 'chilled', 10, 'Contains fish', 'Product of New Zealand') returning id into p_tarf;
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('GUR-WHL-C', 'Red gurnard, whole, chilled', s_gur, 'whole', 'chilled', 15, 'Contains fish', 'Product of New Zealand') returning id into p_gurw;
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('KIN-LOIN-C', 'Kingfish loins, chilled', s_kin, 'portion', 'chilled', 10, 'Contains fish', 'Product of New Zealand') returning id into p_kinc;
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('KIN-LOIN-F', 'Kingfish loins, frozen', s_kin, 'portion', 'frozen', 10, 'Contains fish', 'Product of New Zealand') returning id into p_kinf;
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('ALB-LOIN-F', 'Albacore loins, frozen', s_alb, 'portion', 'frozen', 10, 'Contains fish', 'Product of New Zealand') returning id into p_albf;
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('CRA-LIVE', 'Rock lobster, live', s_cra, 'live', 'live', 10, 'Contains crustacea', 'Product of New Zealand') returning id into p_cral;
  insert into products (code, name, species_id, form, storage, nominal_case_kg, allergen_statement, origin_statement) values ('SCA-MEAT-C', 'Scallop meat, roe on, chilled', s_sca, 'meat', 'chilled', 5, null, 'Product of New Zealand') returning id into p_scam;

  -- The cold store ---------------------------------------------------------------
  insert into coolrooms (name, kind, target_min_c, target_max_c) values ('Chiller 1', 'chiller', 0, 4) returning id into rm_c1;
  insert into coolrooms (name, kind, target_min_c, target_max_c) values ('Chiller 2', 'chiller', 0, 4) returning id into rm_c2;
  insert into coolrooms (name, kind, target_min_c, target_max_c) values ('Freezer 1', 'freezer', -25, -18) returning id into rm_f1;
  insert into coolrooms (name, kind, target_min_c, target_max_c) values ('Live tank', 'live tank', 10, 15) returning id into rm_lt;
  insert into coolrooms (name, kind, target_min_c, target_max_c) values ('Hold cage', 'freezer', -25, -18) returning id into rm_hc;

  insert into temp_checks (room_id, checked_at, temp_c, checked_by) values
    (rm_c1, now() - interval '50 hours', 2.4, 'Ana'), (rm_c1, now() - interval '26 hours', 2.1, 'Ana'), (rm_c1, now() - interval '3 hours', 1.9, 'Ana'),
    (rm_c2, now() - interval '27 hours', 3.2, 'Ana'), (rm_c2, now() - interval '2 hours', 6.5, 'Tom'),
    (rm_f1, now() - interval '28 hours', -21.5, 'Tom'), (rm_f1, now() - interval '4 hours', -22.0, 'Tom'),
    (rm_lt, now() - interval '54 hours', 12.5, 'Tom'), (rm_lt, now() - interval '30 hours', 12.8, 'Tom'),
    (rm_hc, now() - interval '5 hours', -20.5, 'Ana');
  insert into temp_checks (room_id, checked_at, temp_c, checked_by, note) values
    (rm_c2, now() - interval '2 hours' + interval '1 minute', 6.5, 'Tom', 'Door seal looks torn. Engineer called.');

  -- Landings -------------------------------------------------------------------
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, price_per_kg, status)
    values ('LND-2101', v_sanm, s_sna, d - 9, 'SM-0412', 'LR-7731904', '038', 14, 820, 2.1, 14.50, 'processed') returning id into l1;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, price_per_kg, status)
    values ('LND-2102', v_sanm, s_tar, d - 9, 'SM-0412', 'LR-7731904', '038', 11, 640, 2.3, 9.80, 'processed') returning id into l2;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, histamine_mg_kg, histamine_tested_on, price_per_kg, status)
    values ('LND-2103', v_kait, s_kin, d - 6, 'KT-0207', 'LR-7740118', '037', 8, 410, 1.8, 12, d - 5, 16.00, 'processed') returning id into l3;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, price_per_kg, status)
    values ('LND-2104', v_sthx, s_alb, d - 4, 'SX-0119', 'LR-7744562', '039', 19, 1150, 1.2, 7.40, 'processed') returning id into l4;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, price_per_kg, status, hold_reason)
    values ('LND-2105', v_rewa, s_cra, d - 3, 'RW-0088', 'LR-7745020', '935', 6, 180, 12.0, 72.00, 'held', 'Fisher permit FP-099314 expired before this landing. A licensed fish receiver buys only from a current permit holder.') returning id into l5;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, price_per_kg, status)
    values ('LND-2106', v_pelo, s_sca, d - 2, 'PD-0031', 'LR-7746311', 'PEL-2', 26, 520, 3.9, 8.50, 'received') returning id into l6;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, price_per_kg, status, hold_reason)
    values ('LND-2107', v_mrose, s_gur, d - 1, 'MR-0254', 'LR-7747089', '038', 6, 300, 6.8, 6.20, 'held', 'Received at 6.8 C against the 4.0 C receiving limit. Held for a QA decision: core temp recheck, sensory, or reject.') returning id into l7;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, status)
    values ('LND-2108', v_mrose, s_sna, d - 3, 'MR-0253', 'LR-7745390', '038', 5, 260, 2.6, 'received') returning id into l8;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, status)
    values ('LND-2109', v_kait, s_tar, d - 2, 'KT-0208', 'LR-7746002', '037', 7, 380, 2.0, 'processed') returning id into l9;
  insert into landings (ref, vessel_id, species_id, landed_on, trip_ref, landing_report_ref, stat_area, bins, kg, receive_temp_c, histamine_mg_kg, histamine_tested_on, price_per_kg, status)
    values ('LND-2110', v_kait, s_kin, d - 12, 'KT-0206', 'LR-7728455', '037', 6, 300, 3.6, 240, d - 10, 16.00, 'processed') returning id into l10;

  -- Runs and cases ---------------------------------------------------------------
  insert into runs (ref, landing_id, run_on, input_kg, line) values ('RUN-701', l1, d - 8, 820, 'Fillet line') returning id into r1;
  insert into runs (ref, landing_id, run_on, input_kg, line) values ('RUN-702', l2, d - 8, 640, 'Fillet line') returning id into r2;
  insert into runs (ref, landing_id, run_on, input_kg, line) values ('RUN-703', l3, d - 5, 410, 'Loin bench') returning id into r3;
  insert into runs (ref, landing_id, run_on, input_kg, line) values ('RUN-704', l4, d - 3, 1150, 'Loin bench') returning id into r4;
  insert into runs (ref, landing_id, run_on, input_kg, line, note) values ('RUN-705', l9, d, 380, 'Fillet line', 'New filleter on the line this morning.') returning id into r5;
  insert into runs (ref, landing_id, run_on, input_kg, line) values ('RUN-706', l10, d - 11, 300, 'Loin bench') returning id into r6;

  -- Customers and orders -----------------------------------------------------------
  insert into customers (name, country, contact_name, email) values ('Nelson Fish Market', 'New Zealand', 'Ray Tuck', 'orders@nelsonfish.example') returning id into c_nfm;
  insert into customers (name, country, contact_name, email) values ('Wellington Restaurant Supply', 'New Zealand', 'Lena Ho', 'lena@wrs.example') returning id into c_wrs;
  insert into customers (name, country, contact_name, email) values ('Kaiyo Trading Co', 'Japan', 'Hiro Sato', 'sato@kaiyo.example') returning id into c_kaiyo;
  insert into customers (name, country, contact_name, email) values ('Sydney Seafood Imports', 'Australia', 'Mark Bell', 'mark@sydseafood.example') returning id into c_syd;
  insert into customers (name, country, contact_name, email) values ('FreshCo Supermarkets', 'New Zealand', 'Jo Pike', 'seafood@freshco.example') returning id into c_fresh;

  insert into orders (ref, customer_id, export, destination, required_on, carrier, status, created_on, dispatched_on)
    values ('ORD-5101', c_nfm, false, 'Nelson', d - 6, 'Own truck', 'dispatched', d - 8, d - 6) returning id into o1;
  insert into orders (ref, customer_id, export, destination, required_on, carrier, created_on)
    values ('ORD-5102', c_wrs, false, 'Wellington', d + 1, 'Interislander freight', d - 4) returning id into o2;
  insert into orders (ref, customer_id, export, destination, required_on, carrier, created_on)
    values ('ORD-5103', c_kaiyo, true, 'Tokyo, Japan', d + 2, 'Air NZ Cargo', d - 5) returning id into o3;
  insert into orders (ref, customer_id, export, destination, required_on, ecert_ref, carrier, created_on)
    values ('ORD-5104', c_syd, true, 'Sydney, Australia', d - 1, 'NZ-EC-2026-118842', 'Air NZ Cargo', d - 6) returning id into o4;

  insert into order_lines (order_id, product_id, kg_ordered, price_per_kg) values
    (o1, p_snaf, 330, 32.00), (o1, p_tarf, 240, 24.00),
    (o2, p_kinc, 120, 38.00),
    (o3, p_albf, 400, 18.50),
    (o4, p_cral, 150, 95.00);

  -- RUN-701: snapper fillets, 18 to the market, 2 left in Chiller 1 past use-by
  for i in 1..20 loop
    n := n + 1;
    insert into cases (case_no, run_id, product_id, net_kg, packed_on, use_by, room, order_id, status)
      values ('CS-' || n, r1, p_snaf, 17.0 + (i % 4) * 0.15, d - 8, d - 1, case when i <= 18 then null else 'Chiller 1' end,
              case when i <= 18 then o1 else null end, case when i <= 18 then 'dispatched' else 'in_store' end);
  end loop;
  -- RUN-702: tarakihi fillets, all to the market
  for i in 1..16 loop
    n := n + 1;
    insert into cases (case_no, run_id, product_id, net_kg, packed_on, use_by, room, order_id, status)
      values ('CS-' || n, r2, p_tarf, 15.6 + (i % 3) * 0.1, d - 8, d - 1, null, o1, 'dispatched');
  end loop;
  -- RUN-703: kingfish loins, 12 allocated to Wellington, 8 unallocated near use-by in Chiller 2
  for i in 1..20 loop
    n := n + 1;
    insert into cases (case_no, run_id, product_id, net_kg, packed_on, use_by, room, order_id)
      values ('CS-' || n, r3, p_kinc, 9.7 + (i % 3) * 0.1, d - 5, d + 2, 'Chiller 2', case when i <= 12 then o2 else null end);
  end loop;
  -- RUN-704: albacore loins, frozen, 40 allocated to Kaiyo (no histamine result, no E-cert)
  for i in 1..60 loop
    n := n + 1;
    insert into cases (case_no, run_id, product_id, net_kg, packed_on, use_by, room, order_id)
      values ('CS-' || n, r4, p_albf, 10.1 + (i % 5) * 0.05, d - 3, d + 537, 'Freezer 1', case when i <= 40 then o3 else null end);
  end loop;
  -- RUN-705: tarakihi fillets this morning, seven points under standard
  for i in 1..8 loop
    n := n + 1;
    insert into cases (case_no, run_id, product_id, net_kg, packed_on, use_by, room)
      values ('CS-' || n, r5, p_tarf, 15.5 + (i % 2) * 0.2, d, d + 7, 'Chiller 1');
  end loop;
  -- RUN-706: the kingfish lot that tested high, frozen and quarantined
  for i in 1..14 loop
    n := n + 1;
    insert into cases (case_no, run_id, product_id, net_kg, packed_on, use_by, room, note)
      values ('CS-' || n, r6, p_kinf, 10.0, d - 11, d + 529, 'Hold cage', 'Quarantined: lot tested over the histamine limit.');
  end loop;

  -- Settlements ------------------------------------------------------------------
  insert into settlements (ref, fisher_id, period_to, status, paid_on) values ('SET-901', f_hawk, d - 7, 'paid', d - 5) returning id into set1;
  update landings set settlement_id = set1 where id in (l1, l2);

  -- The decision trail -------------------------------------------------------------
  insert into notes (target_kind, target_id, target_label, body, noted_at) values
    ('landing', l5, 'LND-2105', 'Rang Sam Ruru: permit renewal lodged late, waiting on FishServe. Lobster in the live tank, not bought until the permit is current.', now() - interval '2 days'),
    ('landing', l10, 'LND-2110', 'Lab result 240 mg/kg histamine. Lot frozen and moved to the Hold cage. Decision pending: destroy or return to fisher.', now() - interval '9 days'),
    ('landing', l6, 'LND-2106', 'Asked Anna for the harvest area clearance for PEL-2. She says the area was open; we need the reference before it goes on the line.', now() - interval '1 day'),
    ('order', o3, 'ORD-5103', 'Kaiyo want the E-cert copy before the flight. Lab sample for the albacore lot not yet sent.', now() - interval '1 day');
end $$;
