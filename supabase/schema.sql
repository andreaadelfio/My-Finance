-- MyFinance: schema Supabase.
-- Esegui tutto nel SQL Editor; si può rieseguire senza perdere dati.

-- Categorie di entrata e di uscita (es. "Ristoranti e bar", "Stipendi e pensioni")
create table if not exists public.categorie (
  id bigint generated always as identity primary key,
  nome text not null,
  tipo text not null check (tipo in ('uscita', 'entrata')),
  created_at timestamptz not null default now(),
  unique (tipo, nome)
);

-- Movimenti del conto: importo negativo = uscita, positivo = entrata
create table if not exists public.movimenti (
  id bigint generated always as identity primary key,
  data date not null,
  operazione text not null default '',
  dettagli text not null default '',
  categoria_id bigint references public.categorie (id) on delete set null,
  importo numeric(12, 2) not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists movimenti_data_idx on public.movimenti (data);

-- Anno e mese calcolati in automatico dalla data: servono per i filtri e per i
-- totali del riepilogo, che il database somma per anno, mese e categoria
alter table public.movimenti
  add column if not exists anno smallint generated always as (extract(year from data)::smallint) stored;
alter table public.movimenti
  add column if not exists mese smallint generated always as (extract(month from data)::smallint) stored;

-- Budget mensile per categoria di uscita, per anno
create table if not exists public.budget (
  id bigint generated always as identity primary key,
  categoria_id bigint not null references public.categorie (id) on delete cascade,
  anno integer not null,
  importo_mensile numeric(12, 2) not null,
  unique (categoria_id, anno)
);

-- Saldo del conto a inizio anno (= saldo a fine dell'anno precedente)
create table if not exists public.saldi (
  anno integer primary key,
  saldo_iniziale numeric(12, 2) not null
);

-- Riepilogo per anno (foglio "Pre 2023"): per gli anni senza movimenti dettagliati
-- (2021, 2022) e i mesi lavorati di ogni anno. Il conto a fine anno si ricava da
-- saldi (saldo a inizio anno) + entrate - uscite.
create table if not exists public.riepiloghi_annuali (
  anno integer primary key,
  mesi_lavorati numeric(4, 1),
  entrate numeric(12, 2),
  uscite numeric(12, 2),
  note text
);

-- Registro investimenti (foglio "Investimenti Dashboard"): una riga per operazione.
-- "posizione" è l'ID dell'Excel: raggruppa le operazioni dello stesso investimento.
-- importo negativo per "Investimento", positivo per rimborsi, cedole e dividendi.
create table if not exists public.investimenti (
  id bigint generated always as identity primary key,
  posizione integer not null,
  data date not null,
  nome text not null,
  isin text,
  prodotto text,
  tipo text,
  operazione text not null check (operazione in ('Investimento', 'Rimborso', 'Cedola', 'Dividendi')),
  quantita numeric(14, 4),
  importo numeric(14, 4) not null,
  commissioni numeric(12, 4),
  tassa numeric(12, 4),
  note text,
  created_at timestamptz not null default now()
);

-- Operazioni "domani" (nell'Excel data =OGGI()+1): il valore attuale di una posizione
-- ancora aperta, come se la si chiudesse domani. Per il sito la loro data è sempre domani,
-- così i grafici mostrano il passato vero e da domani ciò che accadrà.
-- La prima volta segna le 10 righe importate dal Portafogli.xlsx con la data fissa
-- del giorno dell'import (fine settembre 2026).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'investimenti' and column_name = 'domani'
  ) then
    alter table public.investimenti add column domani boolean not null default false;
    update public.investimenti set domani = true
    where data between '2026-09-20' and '2026-10-05' and operazione in ('Rimborso', 'Cedola');
  end if;
end;
$$;

-- Quotazioni delle posizioni aperte (esclusi i BTP), scritte dalla Edge Function
-- "aggiorna-quotazioni": prezzo di oggi da Yahoo Finance, quote, costo, valore se si
-- vendesse domani e plusvalenza. quote_stimate = quantità mancante negli acquisti,
-- ricavata dal prezzo del giorno d'acquisto (da controllare: sul sito è in giallo).
create table if not exists public.quotazioni (
  posizione integer primary key,
  isin text not null,
  simbolo text,
  prezzo numeric(14, 4),
  data_prezzo date,
  quote numeric(14, 4),
  quote_stimate boolean not null default false,
  costo numeric(14, 2),
  valore numeric(14, 2),
  plusvalenza numeric(14, 2),
  errore text,
  aggiornato_il timestamptz not null default now()
);

-- Non più usate: l'ABP è in investimenti e il book value si calcola (quote × ABP)
alter table public.quotazioni add column if not exists abp numeric(14, 4);
alter table public.quotazioni add column if not exists book_value numeric(14, 2);

-- ABP (prezzo medio di carico) copiato dal conto dopo l'operazione: per la posizione vale
-- quello dell'operazione più recente che ce l'ha (usato da "aggiorna-quotazioni")
alter table public.investimenti add column if not exists abp numeric(14, 6);

-- Watchlist della sezione Proposte: i titoli da tenere d'occhio (isin e note li gestisce
-- l'utente dal sito). Il resto lo scrive la Edge Function "aggiorna-quotazioni" (azione
-- "watchlist"): prezzo, trend, RSI, volatilità, dividendi, segnale e motivi, lo storico
-- di due anni (per il grafico) e l'andamento settimanale dell'ultimo anno.
create table if not exists public.watchlist (
  isin text primary key,
  simbolo text,
  nome text,
  settore text,
  note text,
  valuta text,
  prezzo numeric,
  prezzo_eur numeric,
  data_prezzo date,
  var_1g numeric,
  var_1m numeric,
  var_3m numeric,
  var_1a numeric,
  massimo_52s numeric,
  minimo_52s numeric,
  sconto numeric,
  sma50 numeric,
  sma200 numeric,
  rsi numeric,
  volatilita numeric,
  rendimento_div numeric,
  trend text,
  segnale text,
  punteggio integer,
  motivi jsonb,
  andamento jsonb,
  storico jsonb,
  errore text,
  aggiornato_il timestamptz,
  aggiunto_il timestamptz not null default now()
);

-- I titoli di ISIN Monitor (isin_metadata.csv), con il simbolo Yahoo
insert into public.watchlist (isin, simbolo, nome, settore) values
  ('NL0011585146', 'RACE.MI', 'Ferrari N.V.', 'Consumer Cyclical'),
  ('US0231351067', 'AMZN', 'Amazon.com, Inc.', 'Consumer Cyclical'),
  ('IT0003497168', 'TIT.MI', 'Telecom Italia S.p.A.', 'Communication Services'),
  ('FR0000131104', 'BNP.PA', 'BNP Paribas SA', 'Financial Services'),
  ('IT0000062957', 'MB.MI', 'Mediobanca S.p.A.', 'Financial Services'),
  ('IT0003796171', 'PST.MI', 'Poste Italiane S.p.A.', 'Industrials'),
  ('IT0000072618', 'ISP.MI', 'Intesa Sanpaolo S.p.A.', 'Financial Services'),
  ('IT0005239360', 'UCG.MI', 'UniCredit S.p.A.', 'Financial Services'),
  ('IT0003128367', 'ENEL.MI', 'Enel SpA', 'Utilities'),
  ('IT0000072170', 'FBK.MI', 'FinecoBank S.p.A.', 'Financial Services'),
  ('IT0005211237', 'IG.MI', 'Italgas S.p.A.', 'Utilities'),
  ('IT0000062072', 'G.MI', 'Assicurazioni Generali S.p.A.', 'Financial Services'),
  ('US4581401001', 'INTC', 'Intel Corporation', 'Technology'),
  ('US69608A1088', 'PLTR', 'Palantir Technologies Inc.', 'Technology'),
  ('IT0003132476', 'ENI.MI', 'Eni S.p.A.', 'Energy'),
  ('US67066G1040', 'NVDA', 'NVIDIA Corporation', 'Technology'),
  ('US0079031078', 'AMD', 'Advanced Micro Devices, Inc.', 'Technology')
on conflict (isin) do nothing;

-- Mappatura "categoria della banca -> mia categoria", usata quando si importano
-- gli estratti conto (dal sito con "+ Excel" o con import_excel.py)
create table if not exists public.mappatura_categorie (
  id bigint generated always as identity primary key,
  categoria_banca text not null unique,
  categoria_id bigint not null references public.categorie (id) on delete cascade
);

-- Nome della categoria accanto a categoria_id (vedi i trigger più sotto)
alter table public.budget add column if not exists categoria text;
alter table public.movimenti add column if not exists categoria text;
alter table public.mappatura_categorie add column if not exists categoria text;

-- Mappatura automatica: un movimento la cui categoria ha il nome di una categoria
-- della banca mappata passa alla categoria mappata (per tutti gli anni)
create or replace function public.applica_mappatura_movimento()
returns trigger
language plpgsql
as $$
declare
  mappata bigint;
begin
  if new.categoria_id is not null then
    select m.categoria_id into mappata
    from public.mappatura_categorie m
    join public.categorie c on c.nome = m.categoria_banca
    where c.id = new.categoria_id and m.categoria_id <> c.id
    limit 1;
    if mappata is not null then
      new.categoria_id := mappata;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists movimenti_mappatura on public.movimenti;
drop trigger if exists movimenti_2_mappatura on public.movimenti;
create trigger movimenti_2_mappatura
before insert or update of categoria_id, categoria on public.movimenti
for each row execute function public.applica_mappatura_movimento();

-- Quando si aggiunge o cambia una mappatura, rimappa anche i movimenti già presenti.
-- Prima copia i budget della categoria della banca sulla categoria mappata (per gli anni
-- in cui questa non ne ha), perché la categoria della banca, rimasta vuota, viene cancellata.
create or replace function public.applica_mappatura_esistenti()
returns trigger
language plpgsql
as $$
begin
  insert into public.budget (categoria_id, anno, importo_mensile)
  select new.categoria_id, b.anno, b.importo_mensile
  from public.budget b
  join public.categorie c on c.id = b.categoria_id
  where c.nome = new.categoria_banca and c.id <> new.categoria_id and b.importo_mensile > 0
  on conflict (categoria_id, anno) do nothing;

  update public.movimenti mv
  set categoria_id = new.categoria_id
  from public.categorie c
  where mv.categoria_id = c.id
    and c.nome = new.categoria_banca
    and c.id <> new.categoria_id;
  return null;
end;
$$;

-- Non più usata (la mappatura ora vale per tutti gli anni)
drop function if exists public.ha_budget(bigint, integer);

drop trigger if exists mappatura_rimappa on public.mappatura_categorie;
create trigger mappatura_rimappa
after insert or update on public.mappatura_categorie
for each row execute function public.applica_mappatura_esistenti();

-- ---------------------------------------------------------------------------
-- Nome della categoria accanto a categoria_id (per lavorare comodi nel Table Editor)
-- in budget, movimenti e mappatura_categorie. Si può scrivere il nome invece
-- dell'id: il database trova l'id. Rinominando una categoria il nome si aggiorna.
-- I trigger partono in ordine alfabetico: 1 nome -> id, 2 mappatura, 3 id -> nome.
-- ---------------------------------------------------------------------------

create or replace function public.categoria_da_nome()
returns trigger
language plpgsql
as $$
declare
  -- A parità di nome si preferisce il tipo coerente (entrata per i movimenti positivi)
  tipo_preferito text := case when (to_jsonb(new) ->> 'importo')::numeric > 0 then 'entrata' else 'uscita' end;
  trovata bigint;
begin
  if new.categoria is not null
     and not exists (select 1 from public.categorie where id = new.categoria_id and nome = new.categoria)
     and (tg_op = 'INSERT' and new.categoria_id is null
          or tg_op = 'UPDATE' and new.categoria is distinct from old.categoria
             and new.categoria_id is not distinct from old.categoria_id) then
    select id into trovata from public.categorie
    where nome = trim(new.categoria)
    order by (tipo = tipo_preferito) desc
    limit 1;
    if trovata is null then
      raise exception 'La categoria "%" non esiste', new.categoria;
    end if;
    new.categoria_id := trovata;
  end if;
  return new;
end;
$$;

create or replace function public.nome_da_categoria()
returns trigger
language plpgsql
as $$
begin
  new.categoria := (select nome from public.categorie where id = new.categoria_id);
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['budget', 'movimenti', 'mappatura_categorie'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_1_categoria_da_nome', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.categoria_da_nome()',
      t || '_1_categoria_da_nome', t
    );
    execute format('drop trigger if exists %I on public.%I', t || '_3_nome_categoria', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.nome_da_categoria()',
      t || '_3_nome_categoria', t
    );
  end loop;
end;
$$;

-- Rinominando una categoria si aggiorna il nome nelle altre tabelle
create or replace function public.rinomina_categoria()
returns trigger
language plpgsql
as $$
begin
  update public.budget set categoria = new.nome where categoria_id = new.id;
  update public.movimenti set categoria = new.nome where categoria_id = new.id;
  update public.mappatura_categorie set categoria = new.nome where categoria_id = new.id;
  return null;
end;
$$;

drop trigger if exists categorie_rinomina on public.categorie;
create trigger categorie_rinomina
after update of nome on public.categorie
for each row execute function public.rinomina_categoria();

-- Budget dell'anno in corso e di quelli futuri (gli anni passati non si toccano):
--  1. se l'anno non ha ancora budget, copia quelli dell'ultimo anno precedente con budget;
--  2. ogni categoria di uscita (tranne quelle della banca già mappate su un'altra) ha la
--     sua riga, a 0 se manca, da compilare nel Table Editor o dalla Dashboard.
-- Per il sito un budget a 0 vale come "nessun budget".
create or replace function public.copia_budget_anno(p_anno integer)
returns void
language plpgsql
as $$
begin
  if p_anno < extract(year from now())::integer then
    return;
  end if;
  -- le righe a 0 non contano come "budget dell'anno"
  if not exists (select 1 from public.budget where anno = p_anno and importo_mensile > 0) then
    insert into public.budget (categoria_id, anno, importo_mensile)
    select categoria_id, p_anno, importo_mensile
    from public.budget
    where anno = (select max(anno) from public.budget where anno < p_anno and importo_mensile > 0)
    on conflict (categoria_id, anno) do nothing;
  end if;
  insert into public.budget (categoria_id, anno, importo_mensile)
  select c.id, p_anno, 0
  from public.categorie c
  where c.tipo = 'uscita'
    and not exists (select 1 from public.mappatura_categorie m where m.categoria_banca = c.nome)
  on conflict (categoria_id, anno) do nothing;
end;
$$;

-- Il primo movimento di un anno nuovo prepara i budget di quell'anno
create or replace function public.budget_anno_nuovo()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.budget where anno = extract(year from new.data)::integer and importo_mensile > 0) then
    perform public.copia_budget_anno(extract(year from new.data)::integer);
  end if;
  return null;
end;
$$;

drop trigger if exists movimenti_budget_anno_nuovo on public.movimenti;
create trigger movimenti_budget_anno_nuovo
after insert on public.movimenti
for each row execute function public.budget_anno_nuovo();

-- Ogni nuova categoria di uscita riceve la sua riga di budget a 0 nell'anno in corso
-- (se l'anno è nuovo, dopo aver copiato i budget dell'anno precedente)
create or replace function public.budget_per_nuova_categoria()
returns trigger
language plpgsql
as $$
begin
  if new.tipo = 'uscita' then
    perform public.copia_budget_anno(extract(year from now())::integer);
  end if;
  return null;
end;
$$;

drop trigger if exists categorie_budget_zero on public.categorie;
create trigger categorie_budget_zero
after insert on public.categorie
for each row execute function public.budget_per_nuova_categoria();

-- Categorie senza movimenti: quando l'ultimo movimento lascia una categoria (eliminato o
-- spostato su un'altra) la categoria viene cancellata, insieme ai suoi budget.
-- Restano le categorie usate come destinazione di una mappatura.
create or replace function public.elimina_categoria_orfana(p_categoria bigint)
returns void
language sql
as $$
  delete from public.categorie c
  where c.id = p_categoria
    and not exists (select 1 from public.movimenti mv where mv.categoria_id = c.id)
    and not exists (select 1 from public.mappatura_categorie m where m.categoria_id = c.id);
$$;

create or replace function public.pulisci_categoria_movimento()
returns trigger
language plpgsql
as $$
begin
  if old.categoria_id is not null and (tg_op = 'DELETE' or old.categoria_id is distinct from new.categoria_id) then
    perform public.elimina_categoria_orfana(old.categoria_id);
  end if;
  return null;
end;
$$;

drop trigger if exists movimenti_pulisci_categorie on public.movimenti;
create trigger movimenti_pulisci_categorie
after delete or update of categoria_id on public.movimenti
for each row execute function public.pulisci_categoria_movimento();

-- Accesso libero con la chiave pubblica, come Listino Prezzi
do $$
declare
  t text;
begin
  foreach t in array array['categorie', 'movimenti', 'budget', 'saldi', 'riepiloghi_annuali', 'investimenti', 'mappatura_categorie', 'quotazioni', 'watchlist'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "accesso pubblico" on public.%I', t);
    execute format(
      'create policy "accesso pubblico" on public.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end;
$$;

-- Mappatura iniziale, ricavata da come erano state ricategorizzate le voci della
-- banca nell'Excel (gennaio 2026) e dalle categorie rinominate negli anni.
-- Non sovrascrive le modifiche fatte dal sito.
insert into public.mappatura_categorie (categoria_banca, categoria_id)
select m.banca, c.id
from (values
  ('Trasporti, noleggi, taxi e parcheggi', 'Trasporti varie'),
  ('Farmacia', 'Spese mediche e Farmacia'),
  ('Pagamento affitti', 'Spese condominiali e affitti'),
  ('Imposte, bolli e commissioni', 'Altre uscite'),
  ('Tabaccai e simili', 'Generi alimentari e supermercato'),
  ('Pedaggi e Telepass', 'Tempo libero varie'),
  ('Addebiti vari', 'Tempo libero varie'),
  ('Imposte sul reddito e tasse varie', 'Spese mediche e Farmacia'),
  ('Corsi e Istruzioni', 'Corsi e Istruzione'),
  ('Investimenti, BDR e XME Salvadanaio', 'Investimenti, BDR e Salvadanaio')
) as m (banca, mia)
join public.categorie c on c.nome = m.mia and c.tipo = 'uscita'
on conflict (categoria_banca) do nothing;

-- Applica una volta la mappatura a tutti i movimenti già presenti, dopo aver copiato
-- i budget delle categorie della banca su quelle mappate (dove mancano)
insert into public.budget (categoria_id, anno, importo_mensile)
select distinct on (m.categoria_id, b.anno) m.categoria_id, b.anno, b.importo_mensile
from public.budget b
join public.categorie c on c.id = b.categoria_id
join public.mappatura_categorie m on m.categoria_banca = c.nome
where m.categoria_id <> c.id and b.importo_mensile > 0
order by m.categoria_id, b.anno, b.importo_mensile desc
on conflict (categoria_id, anno) do nothing;

update public.movimenti mv
set categoria_id = m.categoria_id
from public.categorie c
join public.mappatura_categorie m on m.categoria_banca = c.nome
where mv.categoria_id = c.id
  and m.categoria_id <> c.id;

-- Riempie il nome della categoria nelle righe già presenti
update public.budget b set categoria = c.nome
from public.categorie c where c.id = b.categoria_id and b.categoria is distinct from c.nome;
update public.movimenti mv set categoria = c.nome
from public.categorie c where c.id = mv.categoria_id and mv.categoria is distinct from c.nome;
update public.mappatura_categorie m set categoria = c.nome
from public.categorie c where c.id = m.categoria_id and m.categoria is distinct from c.nome;

-- Cancella una volta le categorie che oggi non hanno movimenti (e i loro budget)
delete from public.categorie c
where not exists (select 1 from public.movimenti mv where mv.categoria_id = c.id)
  and not exists (select 1 from public.mappatura_categorie m where m.categoria_id = c.id);

-- Righe di budget dell'anno in corso per tutte le categorie di uscita (a 0 se mancano)
select public.copia_budget_anno(extract(year from now())::integer);

-- Permette le somme nelle query (totali della lista movimenti e del riepilogo)
alter role authenticator set pgrst.db_aggregates_enabled = 'true';

-- Fa vedere subito le nuove tabelle e impostazioni all'API di Supabase
notify pgrst, 'reload schema';
notify pgrst, 'reload config';

-- Aggiornamento automatico delle quotazioni dal lunedì al venerdì alle 20:00 UTC
-- (22 in estate, 21 in inverno), dopo la chiusura delle borse (facoltativo).
-- Richiede le estensioni pg_cron e pg_net (Database -> Extensions) e la Edge Function
-- "aggiorna-quotazioni" pubblicata. La funzione impiega circa 20 secondi: pg_net di
-- default aspetta 5 secondi, da qui timeout_milliseconds. Per toglierlo:
-- select cron.unschedule('aggiorna-quotazioni');
-- select cron.schedule('aggiorna-quotazioni', '0 20 * * 1-5', $$
--   select net.http_post(
--     url := 'https://fvhzmkvqizfnbgxexdgu.supabase.co/functions/v1/aggiorna-quotazioni',
--     headers := '{"Content-Type": "application/json"}'::jsonb,
--     body := '{}'::jsonb,
--     timeout_milliseconds := 60000
--   );
-- $$);
