// Edge Function "aggiorna-quotazioni": valore "se vendo domani" delle posizioni aperte.
//
// Per ogni posizione con acquisti e senza un rimborso già avvenuto (esclusi i BTP, che si
// tengono fino a scadenza, e le posizioni senza ISIN) prende da Yahoo Finance il prezzo di
// oggi e quello del giorno d'acquisto, poi aggiorna le due righe "domani" della posizione:
//   Rimborso = costo d'acquisto
//   Cedola   = plusvalenza = quote × prezzo di oggi − costo (negativa se in perdita)
// ABP (prezzo medio di carico, copiato dal conto) = quello dell'operazione più recente della
// posizione che ce l'ha. Quote = somma delle quantità degli acquisti; se mancano, la somma
// degli acquisti / ABP; senza ABP si stimano
// dal prezzo del giorno d'acquisto e la posizione è "quote_stimate" (in giallo sul sito).
// Costo = quote × ABP, o la somma degli acquisti se l'ABP non c'è.
// Il riepilogo di ogni posizione va nella tabella "quotazioni".
//
// Chiamata: POST, corpo facoltativo {"prova": true} per calcolare senza scrivere.

const YAHOO = "https://query1.finance.yahoo.com";
const HEADERS_YAHOO = { "User-Agent": "Mozilla/5.0" };
const BORSE_EURO = ["MI", "AS", "DE", "PA", "F"];

type Riga = {
  id: number;
  posizione: number;
  data: string;
  nome: string;
  isin: string | null;
  prodotto: string | null;
  tipo: string | null;
  operazione: string;
  quantita: number | null;
  importo: number;
  abp: number | null;
  domani: boolean;
};

type Quotazione = { simbolo: string; prezzo: number; data: string; cambio: number };

const round2 = (v: number) => Math.round(v * 100) / 100;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function yahoo(path: string) {
  const risposta = await fetch(YAHOO + path, { headers: HEADERS_YAHOO });
  if (!risposta.ok) throw new Error(`Yahoo ${risposta.status} su ${path.split("?")[0]}`);
  return risposta.json();
}

async function grafico(simbolo: string, query = "range=5d&interval=1d") {
  const dati = await yahoo(`/v8/finance/chart/${encodeURIComponent(simbolo)}?${query}`);
  const risultato = dati.chart?.result?.[0];
  if (!risultato) throw new Error(`nessun dato per ${simbolo}`);
  return risultato;
}

// Cambio verso l'euro della valuta del titolo (GBp = pence)
async function cambioInEuro(valuta: string) {
  if (valuta === "EUR") return 1;
  const pence = valuta === "GBp";
  const meta = (await grafico(`${pence ? "GBP" : valuta}EUR=X`)).meta;
  return meta.regularMarketPrice / (pence ? 100 : 1);
}

// Simbolo dell'ISIN: prima una quotazione in euro (Milano, Amsterdam, ...), altrimenti
// quella trovata convertita in euro
async function quotazioneAttuale(isin: string): Promise<Quotazione> {
  const ricerca = await yahoo(`/v1/finance/search?q=${isin}&quotesCount=10&newsCount=0`);
  const simboli: string[] = (ricerca.quotes || []).map((q: { symbol: string }) => q.symbol);
  if (!simboli.length) throw new Error("ISIN non trovato su Yahoo Finance");
  const candidati = [...new Set([
    ...simboli.flatMap((s) => BORSE_EURO.map((borsa) => `${s.split(".")[0]}.${borsa}`)),
    ...simboli
  ])];
  let ripiego: Quotazione | null = null;
  for (const simbolo of candidati) {
    let meta;
    try {
      meta = (await grafico(simbolo)).meta;
    } catch {
      continue;
    }
    if (!meta?.regularMarketPrice) continue;
    const data = isoDate(new Date(meta.regularMarketTime * 1000));
    if (meta.currency === "EUR") return { simbolo, prezzo: meta.regularMarketPrice, data, cambio: 1 };
    if (!ripiego && simboli.includes(simbolo)) {
      ripiego = { simbolo, prezzo: meta.regularMarketPrice, data, cambio: await cambioInEuro(meta.currency) };
    }
  }
  if (ripiego) return { ...ripiego, prezzo: ripiego.prezzo * ripiego.cambio };
  throw new Error("nessuna quotazione disponibile");
}

// Prezzo di chiusura (in euro) del giorno d'acquisto, o dell'ultimo giorno di borsa prima
async function prezzoAlGiorno(q: Quotazione, giorno: string) {
  const fine = Math.floor(new Date(`${giorno}T23:59:59Z`).getTime() / 1000);
  const risultato = await grafico(q.simbolo, `period1=${fine - 14 * 86400}&period2=${fine}&interval=1d`);
  const chiusure: (number | null)[] = risultato.indicators?.quote?.[0]?.close || [];
  const ultimo = chiusure.filter((v): v is number => v != null).pop();
  if (!ultimo) throw new Error(`nessun prezzo al ${giorno}`);
  return ultimo * q.cambio;
}

// Accesso alle tabelle con l'API REST di Supabase
function database(url: string, chiave: string) {
  const headers = { apikey: chiave, "Content-Type": "application/json" } as Record<string, string>;
  if (!chiave.startsWith("sb_")) headers.Authorization = `Bearer ${chiave}`;
  return async (method: string, path: string, body?: unknown, prefer?: string) => {
    const risposta = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const testo = await risposta.text();
    if (!risposta.ok) throw new Error(`${method} ${path.split("?")[0]}: ${testo}`);
    // Inserimenti e modifiche rispondono senza corpo
    return testo ? JSON.parse(testo) : null;
  };
}

export async function aggiornaQuotazioni(url: string, chiave: string, prova = false) {
  const db = database(url, chiave);
  const righe: Riga[] = (await db("GET", "investimenti?select=*&order=posizione,data,id"))
    .map((r: Riga) => ({
      ...r,
      importo: Number(r.importo),
      quantita: r.quantita === null ? null : Number(r.quantita),
      abp: r.abp == null ? null : Number(r.abp)
    }));
  const oggi = isoDate(new Date());
  const domani = isoDate(new Date(Date.now() + 86400000));

  const posizioni = new Map<number, Riga[]>();
  for (const r of righe) posizioni.set(r.posizione, [...(posizioni.get(r.posizione) || []), r]);

  const esito = [];
  for (const [posizione, operazioni] of posizioni) {
    const acquisti = operazioni.filter((r) => r.operazione === "Investimento");
    const primo = acquisti[0];
    const chiusa = operazioni.some((r) => r.operazione === "Rimborso" && !r.domani && r.data <= oggi);
    if (!primo || chiusa || !primo.isin || primo.prodotto === "BTP") continue;

    const riepilogo: Record<string, unknown> = {
      posizione, isin: primo.isin, aggiornato_il: new Date().toISOString(),
      simbolo: null, prezzo: null, data_prezzo: null, quote: null, quote_stimate: false,
      costo: null, valore: null, plusvalenza: null, errore: null
    };
    try {
      const q = await quotazioneAttuale(primo.isin);
      // ABP dal conto: quello dell'operazione più recente (le righe sono in ordine di data)
      const abp = operazioni.filter((r) => r.abp && r.abp > 0).pop()?.abp || 0;
      const registrato = round2(acquisti.reduce((s, r) => s + Math.abs(r.importo), 0));
      const quantitaNote = acquisti.every((r) => r.quantita);
      const quoteNote = quantitaNote || abp > 0;
      // Senza quantità né ABP: quote = importo / prezzo del giorno d'acquisto
      let quote = 0;
      if (quantitaNote) quote = acquisti.reduce((s, r) => s + r.quantita!, 0);
      else if (abp) quote = registrato / abp;
      else for (const r of acquisti) quote += Math.abs(r.importo) / await prezzoAlGiorno(q, r.data);
      const costo = abp ? round2(quote * abp) : registrato;
      const valore = round2(quote * q.prezzo);
      const plusvalenza = round2(valore - costo);
      Object.assign(riepilogo, {
        simbolo: q.simbolo, prezzo: round2(q.prezzo * 10000) / 10000, data_prezzo: q.data,
        quote: Math.round(quote * 10000) / 10000, quote_stimate: !quoteNote, costo, valore, plusvalenza
      });

      // Righe "domani": Rimborso al costo degli acquisti registrati (così il risultato della
      // posizione è la plusvalenza) e Cedola con la plusvalenza (create se mancano)
      const base = {
        posizione, data: domani, domani: true, nome: primo.nome, isin: primo.isin,
        prodotto: primo.prodotto, tipo: primo.tipo, quantita: quoteNote ? quote : null
      };
      const nota = `Plusvalenza: ${riepilogo.quote} quote × ${riepilogo.prezzo} € (${q.simbolo}, ${q.data})${abp ? ` – ABP ${abp} € dal conto` : quoteNote ? "" : " – quote stimate"}`;
      const aggiornamenti: [string, Record<string, unknown>][] = [
        ["Rimborso", { importo: registrato }],
        ["Cedola", { importo: plusvalenza, note: nota }]
      ];
      for (const [operazione, valori] of aggiornamenti) {
        const esistente = operazioni.find((r) => r.domani && r.operazione === operazione);
        if (prova) continue;
        if (esistente) await db("PATCH", `investimenti?id=eq.${esistente.id}`, { ...valori, quantita: base.quantita });
        else await db("POST", "investimenti", { ...base, operazione, ...valori });
      }
    } catch (errore) {
      riepilogo.errore = errore instanceof Error ? errore.message : String(errore);
    }
    if (!prova) await db("POST", "quotazioni?on_conflict=posizione", riepilogo, "resolution=merge-duplicates");
    esito.push(riepilogo);
  }
  return esito;
}

// Su Supabase (Deno): risponde alle chiamate del sito e del pg_cron
declare const Deno: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } } | undefined;
if (typeof Deno !== "undefined") {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      const corpo = await request.json().catch(() => ({}));
      const esito = await aggiornaQuotazioni(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        Boolean(corpo.prova)
      );
      return Response.json(esito, { headers: cors });
    } catch (errore) {
      return Response.json({ errore: String(errore) }, { status: 500, headers: cors });
    }
  });
}
