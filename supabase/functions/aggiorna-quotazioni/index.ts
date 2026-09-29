// Edge Function "aggiorna-quotazioni", due parti:
//   posizioni: valore "se vendo domani" delle posizioni aperte (tabelle investimenti e quotazioni)
//   watchlist: analisi dei titoli da tenere d'occhio e segnali per la sezione Proposte (più sotto)
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

// ---------------------------------------------------------------------------
// Proposte: analisi giornaliera dei titoli della watchlist
// ---------------------------------------------------------------------------
//
// Per ogni ISIN della tabella "watchlist" prende da Yahoo due anni di chiusure giornaliere
// e i dividendi, calcola trend (medie a 50 e 200 giorni), distanza dal massimo di 52
// settimane, RSI a 14 giorni, volatilità e rendimento da dividendi, e assegna un segnale:
//   compra  = trend al rialzo e prezzo sceso dal massimo di almeno un quarto della volatilità
//             annua (tra 5% e 20%), RSI non alto: un ritracciamento in un trend positivo
//   valuta  = trend incerto ma titolo ipervenduto (RSI ≤ 35) e sceso dal massimo: possibile
//             rimbalzo, più rischioso
//   attendi = trend positivo ma vicino ai massimi, o ipercomprato (RSI ≥ 70), o nessun segnale
//   evita   = sotto la media a 200 giorni con la media a 50 sotto quella a 200: trend negativo
// Il punteggio (0-100) ordina i titoli: trend 40, ritracciamento 30, RSI 20, dividendi 10.
// Sono regole meccaniche di analisi tecnica, non una consulenza.

type Punto = [string, number];

const media = (valori: number[], n: number) =>
  valori.length < n ? null : valori.slice(-n).reduce((s, v) => s + v, 0) / n;

// RSI di Wilder: forza dei rialzi rispetto ai ribassi (sopra 70 ipercomprato, sotto 30 ipervenduto)
function rsi(chiusure: number[], n = 14) {
  if (chiusure.length <= n) return null;
  let rialzi = 0;
  let ribassi = 0;
  for (let i = 1; i <= n; i++) {
    const d = chiusure[i] - chiusure[i - 1];
    if (d > 0) rialzi += d;
    else ribassi -= d;
  }
  let mediaRialzi = rialzi / n;
  let mediaRibassi = ribassi / n;
  for (let i = n + 1; i < chiusure.length; i++) {
    const d = chiusure[i] - chiusure[i - 1];
    mediaRialzi = (mediaRialzi * (n - 1) + Math.max(d, 0)) / n;
    mediaRibassi = (mediaRibassi * (n - 1) + Math.max(-d, 0)) / n;
  }
  return mediaRibassi === 0 ? 100 : 100 - 100 / (1 + mediaRialzi / mediaRibassi);
}

// Variazione % rispetto a N giorni di borsa fa
function variazione(chiusure: number[], giorni: number) {
  const i = chiusure.length - 1 - giorni;
  return i < 0 ? null : (chiusure[chiusure.length - 1] / chiusure[i] - 1) * 100;
}

const arrotonda = (v: number | null, cifre = 2) => (v === null ? null : Math.round(v * 10 ** cifre) / 10 ** cifre);
const percento = (v: number) => `${v.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;

export function analizza(punti: Punto[], dividendi: { data: string; importo: number }[]) {
  const chiusure = punti.map((p) => p[1]);
  const prezzo = chiusure[chiusure.length - 1];
  const anno = chiusure.slice(-252);
  const massimo = Math.max(...anno);
  const minimo = Math.min(...anno);
  const sconto = (1 - prezzo / massimo) * 100;
  const sma50 = media(chiusure, 50);
  const sma200 = media(chiusure, 200);
  const forza = rsi(chiusure.slice(-300));
  const rendimenti = anno.slice(1).map((v, i) => Math.log(v / anno[i]));
  const m = rendimenti.reduce((s, v) => s + v, 0) / rendimenti.length;
  const volatilita = Math.sqrt(rendimenti.reduce((s, v) => s + (v - m) ** 2, 0) / (rendimenti.length - 1)) * Math.sqrt(252) * 100;
  const unAnnoFa = isoDate(new Date(Date.now() - 365 * 86400000));
  const rendimentoDiv = (dividendi.filter((d) => d.data > unAnnoFa).reduce((s, d) => s + d.importo, 0) / prezzo) * 100;

  const trend = sma200 === null || sma50 === null ? "laterale"
    : prezzo > sma200 && sma50 > sma200 ? "rialzo"
    : prezzo < sma200 && sma50 < sma200 ? "ribasso"
    : "laterale";
  // Un calo "significativo" dipende da quanto si muove il titolo: un quarto della volatilità annua
  const soglia = Math.min(20, Math.max(5, volatilita * 0.25));
  const r = forza ?? 50;

  const motivi: string[] = [];
  let segnale: string;
  if (trend === "ribasso") {
    segnale = "evita";
    motivi.push(`Trend negativo: prezzo sotto la media a 200 giorni (${arrotonda(sma200)}) e media a 50 giorni sotto quella a 200.`);
    if (r <= 30) motivi.push(`Molto ipervenduto (RSI ${Math.round(r)}): può rimbalzare, ma finché il trend resta negativo è una scommessa.`);
  } else if (r >= 70) {
    segnale = "attendi";
    motivi.push(`Ipercomprato (RSI ${Math.round(r)}): dopo una salita così forte spesso segue una pausa.`);
  } else if (trend === "rialzo" && sconto >= soglia && r <= 55) {
    segnale = "compra";
    motivi.push(`Trend positivo e prezzo sceso del ${percento(sconto)} dal massimo di 52 settimane: un ritracciamento in una tendenza al rialzo.`);
    motivi.push(`Se scende sotto ${arrotonda(sma200)} (media a 200 giorni) il trend si indebolisce: livello da tenere d'occhio.`);
  } else if (trend === "laterale" && r <= 35 && sconto >= soglia) {
    segnale = "valuta";
    motivi.push(`Ipervenduto (RSI ${Math.round(r)}) e sceso del ${percento(sconto)} dal massimo, ma senza un trend chiaro: possibile rimbalzo, più rischioso.`);
  } else if (trend === "rialzo") {
    segnale = "attendi";
    motivi.push(`Trend positivo ma solo ${percento(sconto)} sotto il massimo: meglio aspettare un calo di almeno il ${percento(soglia)}.`);
  } else {
    segnale = "attendi";
    motivi.push(`Nessun trend chiaro (prezzo vicino alla media a 200 giorni): nessun segnale.`);
  }
  if (rendimentoDiv >= 3) motivi.push(`Dividendi dell'ultimo anno: ${percento(rendimentoDiv)} del prezzo.`);
  if (volatilita >= 40) motivi.push(`Titolo molto volatile (${Math.round(volatilita)}% annuo): movimenti ampi in entrambe le direzioni.`);

  const punteggio = Math.round(
    (trend === "rialzo" ? 40 : trend === "laterale" ? 20 : 0) +
    (trend === "ribasso" ? 0 : (Math.min(sconto / soglia, 2) / 2) * 30) +
    ((70 - Math.min(70, Math.max(30, r))) / 40) * 20 +
    Math.min(rendimentoDiv / 5, 1) * 10
  );

  // Andamento dell'ultimo anno a punti settimanali, per il grafico piccolo del sito
  const ultimi = chiusure.slice(-260);
  const andamento = ultimi.filter((_, i) => (ultimi.length - 1 - i) % 5 === 0).map((v) => arrotonda(v, 4));

  return {
    prezzo: arrotonda(prezzo, 4),
    data_prezzo: punti[punti.length - 1][0],
    var_1g: arrotonda(variazione(chiusure, 1)),
    var_1m: arrotonda(variazione(chiusure, 21)),
    var_3m: arrotonda(variazione(chiusure, 63)),
    var_1a: arrotonda(variazione(chiusure, 252)),
    massimo_52s: arrotonda(massimo, 4),
    minimo_52s: arrotonda(minimo, 4),
    sconto: arrotonda(sconto),
    sma50: arrotonda(sma50, 4),
    sma200: arrotonda(sma200, 4),
    rsi: arrotonda(forza),
    volatilita: arrotonda(volatilita),
    rendimento_div: arrotonda(rendimentoDiv),
    trend,
    segnale,
    punteggio,
    motivi,
    andamento
  };
}

// Due anni di chiusure giornaliere e i dividendi
export async function storicoGiornaliero(simbolo: string) {
  const r = await grafico(simbolo, "range=2y&interval=1d&events=div");
  const chiusure: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
  const punti = (r.timestamp || [])
    .map((t: number, i: number) => [isoDate(new Date(t * 1000)), chiusure[i]])
    .filter((p: [string, number | null]) => p[1] != null) as Punto[];
  if (punti.length < 60) throw new Error(`storico troppo corto per ${simbolo}`);
  const dividendi = Object.values(r.events?.dividends || {}).map((d) => {
    const div = d as { date: number; amount: number };
    return { data: isoDate(new Date(div.date * 1000)), importo: div.amount };
  });
  return { punti, dividendi, valuta: r.meta.currency as string, nome: (r.meta.longName || r.meta.shortName) as string };
}

export async function analizzaWatchlist(url: string, chiave: string, prova = false) {
  const db = database(url, chiave);
  const titoli: { isin: string; simbolo: string | null; nome: string | null; settore: string | null }[] =
    await db("GET", "watchlist?select=isin,simbolo,nome,settore&order=isin");
  const cambi = new Map<string, number>();
  const esito = [];
  for (const t of titoli) {
    const riga: Record<string, unknown> = { isin: t.isin, aggiornato_il: new Date().toISOString(), errore: null };
    try {
      let { simbolo, nome, settore } = t;
      // Simbolo, nome e settore dalla ricerca per ISIN (solo se mancano: poi restano salvati)
      if (!simbolo || !settore) {
        const ricerca = await yahoo(`/v1/finance/search?q=${t.isin}&quotesCount=5&newsCount=0`);
        const trovato = (ricerca.quotes || [])[0];
        simbolo ||= trovato?.symbol ?? null;
        settore ||= trovato?.sector ?? null;
        nome ||= trovato?.longname || trovato?.shortname || null;
      }
      if (!simbolo) throw new Error("ISIN non trovato su Yahoo Finance: inserisci il simbolo a mano");
      const storico = await storicoGiornaliero(simbolo);
      const analisi = analizza(storico.punti, storico.dividendi);
      if (!cambi.has(storico.valuta)) cambi.set(storico.valuta, await cambioInEuro(storico.valuta));
      Object.assign(riga, analisi, {
        simbolo, settore, nome: nome || storico.nome, valuta: storico.valuta,
        prezzo_eur: arrotonda(analisi.prezzo! * cambi.get(storico.valuta)!, 4),
        storico: storico.punti.map(([d, c]) => [d, arrotonda(c, 4)])
      });
    } catch (errore) {
      riga.errore = errore instanceof Error ? errore.message : String(errore);
    }
    // PATCH: la riga esiste già e le note dell'utente restano
    if (!prova) await db("PATCH", `watchlist?isin=eq.${encodeURIComponent(t.isin)}`, riga);
    delete riga.storico;
    esito.push(riga);
  }
  return esito;
}

// Su Supabase (Deno): risponde alle chiamate del sito e del pg_cron.
// Corpo: {"azione": "posizioni" | "watchlist"} per una sola parte (senza: tutte e due),
// {"prova": true} per calcolare senza scrivere.
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
      const url = Deno.env.get("SUPABASE_URL")!;
      const chiave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const prova = Boolean(corpo.prova);
      if (corpo.azione === "posizioni") return Response.json(await aggiornaQuotazioni(url, chiave, prova), { headers: cors });
      if (corpo.azione === "watchlist") return Response.json(await analizzaWatchlist(url, chiave, prova), { headers: cors });
      const esito = {
        posizioni: await aggiornaQuotazioni(url, chiave, prova),
        watchlist: await analizzaWatchlist(url, chiave, prova)
      };
      return Response.json(esito, { headers: cors });
    } catch (errore) {
      return Response.json({ errore: String(errore) }, { status: 500, headers: cors });
    }
  });
}
