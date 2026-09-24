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

-- Accesso libero con la chiave pubblica, come Listino Prezzi
do $$
declare
  t text;
begin
  foreach t in array array['categorie', 'movimenti', 'budget', 'saldi'] loop
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
