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

-- Quando si aggiunge o cambia una mappatura, rimappa anche i movimenti già presenti
create or replace function public.applica_mappatura_esistenti()
returns trigger
language plpgsql
as $$
begin
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

-- Accesso libero con la chiave pubblica, come Listino Prezzi
do $$
declare
  t text;
begin
  foreach t in array array['categorie', 'movimenti', 'budget', 'saldi', 'investimenti', 'mappatura_categorie'] loop
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

-- Applica una volta la mappatura a tutti i movimenti già presenti
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

-- Permette le somme nelle query (totali della lista movimenti e del riepilogo)
alter role authenticator set pgrst.db_aggregates_enabled = 'true';

-- Fa vedere subito le nuove tabelle e impostazioni all'API di Supabase
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
