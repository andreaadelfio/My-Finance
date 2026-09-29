-- Sezione Proposte: da eseguire una volta nell'SQL Editor di Supabase (è lo stesso blocco
-- di schema.sql, più le regole di accesso). Si può rieseguire senza danni.

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

alter table public.watchlist enable row level security;
drop policy if exists "accesso pubblico" on public.watchlist;
create policy "accesso pubblico" on public.watchlist for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.watchlist to anon, authenticated;
