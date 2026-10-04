const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const PAGE_SIZE = 1000;
const LISTA_PAGINA = 100; // movimenti caricati a ogni scorrimento

const state = {
  supabase: null,
  year: undefined, // anno della Dashboard; null = tutti gli anni
  tipoDashboard: "sintesi", // la Dashboard mostra la sintesi, le uscite o le entrate
  gruppiAperti: new Set(), // gruppi della tabella andamento con le categorie visibili
  years: [],
  categorie: [],
  aggregati: [], // somme per anno, mese e categoria calcolate dal database
  budget: [],
  saldi: new Map(), // anno -> saldo del conto a inizio anno
  riepiloghi: new Map(), // anno -> { mesi, entrate, uscite } dal foglio "Pre 2023"
  mappatura: [], // categoria della banca -> mia categoria
  importazione: null, // anteprima del file Excel in corso di importazione
  investimenti: [],
  quotazioni: new Map(), // posizione -> prezzo di oggi e plusvalenza (Edge Function "aggiorna-quotazioni")
  fineco: null, // conto Fineco: { tipi: Map(tipo -> somma), liquidita, ultimaData }
  costiFineco: [], // costi e interessi del conto Fineco, come righe (sola lettura) del registro
  contoOggi: null, // saldo del conto Intesa a oggi: saldo a inizio anno + movimenti dell'anno
  usciteMese: [], // uscite del mese in corso per categoria: [{ categoria_id, speso }]
  importFineco: null, // anteprima dell'estratto Fineco in corso di importazione
  watchlist: [], // titoli della sezione Proposte con segnale e motivi (senza lo storico, caricato a richiesta)
  graficoProposta: null, // ISIN con il grafico aperto nella sezione Proposte
  // Lista Movimenti: tutti gli anni, caricata a pagine mentre si scorre
  lista: { righe: [], finita: false, caricamento: false, richiesta: 0 },
  filtroTimeoutId: null,
  editingId: null, // movimento in modifica nella lista (matita)
  ordinamento: { colonna: "data", crescente: false }, // lista movimenti
  ordinamentoInv: { colonna: "data", crescente: true }, // registro investimenti: prima il passato
  editingInvestimentoId: null,
  filtriInv: { posizione: "", stato: "", operazione: "", tipo: "", anno: "", testo: "" }, // registro investimenti
  charts: {},
  feedbackTimeoutId: null
};

const elements = {
  yearSelects: [...document.querySelectorAll(".year-select")],
  tabs: [...document.querySelectorAll(".tab")],
  refreshButton: document.querySelector("#refresh-button"),
  feedback: document.querySelector("#feedback"),
  viewMovimenti: document.querySelector("#view-movimenti"),
  viewDashboard: document.querySelector("#view-dashboard"),
  toggleButtons: [...document.querySelectorAll(".toggle-button")],
  tortaCategorie: document.querySelector("#torta-categorie"),
  patrimonio: document.querySelector("#patrimonio"),
  questoMeseTitolo: document.querySelector("#questo-mese-titolo"),
  questoMeseLista: document.querySelector("#questo-mese-lista"),
  titoloGraficoLinee: document.querySelector("#titolo-grafico-linee"),
  titoloGraficoCategorie: document.querySelector("#titolo-grafico-categorie"),
  saldoField: document.querySelector("#saldo-field"),
  andamentoHint: document.querySelector("#andamento-hint"),
  titoloPeriodo: document.querySelector(".titolo-periodo"),
  viewInvestimenti: document.querySelector("#view-investimenti"),
  viewDashboardInvestimenti: document.querySelector("#view-dashboard-investimenti"),
  chartAndamento: document.querySelector("#chart-andamento"),
  chartCategorie: document.querySelector("#chart-categorie"),
  sortButtons: [...document.querySelectorAll(".sort-button[data-sort]")],
  sortButtonsInv: [...document.querySelectorAll(".sort-button[data-sort-inv]")],
  filterAnno: document.querySelector("#filter-anno"),
  filterMese: document.querySelector("#filter-mese"),
  filterCategoria: document.querySelector("#filter-categoria"),
  filterTesto: document.querySelector("#filter-testo"),
  filterReset: document.querySelector("#filter-reset"),
  totali: document.querySelector("#totali"),
  movimentiBody: document.querySelector("#movimenti-body"),
  excelButton: document.querySelector("#excel-button"),
  excelInput: document.querySelector("#excel-input"),
  importPanel: document.querySelector("#import-panel"),
  mappaturaButton: document.querySelector("#mappatura-button"),
  mappaturaPanel: document.querySelector("#mappatura-panel"),
  listaFine: document.querySelector("#lista-fine"),
  saldoValore: document.querySelector("#saldo-valore"),
  budgetHint: document.querySelector("#budget-hint"),
  andamentoTable: document.querySelector("#andamento-table"),

  invNuova: document.querySelector("#i-nuova"),
  invFiltri: {
    posizione: document.querySelector("#inv-filtro-posizione"),
    stato: document.querySelector("#inv-filtro-stato"),
    operazione: document.querySelector("#inv-filtro-operazione"),
    tipo: document.querySelector("#inv-filtro-tipo"),
    anno: document.querySelector("#inv-filtro-anno"),
    testo: document.querySelector("#inv-filtro-testo")
  },
  invFiltroReset: document.querySelector("#inv-filtro-reset"),
  invTotali: document.querySelector("#inv-totali"),
  invFuture: document.querySelector("#i-future"),
  investimentiList: document.querySelector("#investimenti-list"),
  tipiList: document.querySelector("#tipi-list"),
  posizioniTable: document.querySelector("#posizioni-table"),
  mercatoTable: document.querySelector("#mercato-table"),
  tipiTable: document.querySelector("#tipi-table"),
  operazioniBody: document.querySelector("#operazioni-body"),
  investimentiSintesi: document.querySelector("#investimenti-sintesi"),
  finecoSintesi: document.querySelector("#fineco-sintesi"),
  finecoButton: document.querySelector("#fineco-button"),
  finecoInput: document.querySelector("#fineco-input"),
  finecoPanel: document.querySelector("#fineco-panel"),
  aggiornaPrezzi: [...document.querySelectorAll(".aggiorna-prezzi")], // Dashboard investimenti e registro
  quotazioniInfo: document.querySelector("#quotazioni-info"),
  viewProposte: document.querySelector("#view-proposte"),
  aggiornaProposte: document.querySelector("#aggiorna-proposte"),
  proposteImporto: document.querySelector("#proposte-importo"),
  proposteCommissione: document.querySelector("#proposte-commissione"),
  proposteInfo: document.querySelector("#proposte-info"),
  propostaGiorno: document.querySelector("#proposta-giorno"),
  proposteLista: document.querySelector("#proposte-lista"),
  watchlistForm: document.querySelector("#watchlist-form"),
  watchlistIsin: document.querySelector("#watchlist-isin"),
  chartTipi: document.querySelector("#chart-tipi"),
  chartInvestimenti: document.querySelector("#chart-investimenti")
};

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

const euroFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const numberFormatter = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });

function formatEuro(value) {
  return euroFormatter.format(value || 0);
}

// Nelle tabelle della dashboard gli importi sono senza "€" per stare in pagina
function formatNumber(value) {
  return numberFormatter.format(value || 0);
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

// Accetta "1.234,56", "1234.56", "12,5"
function parseAmount(text) {
  let value = String(text || "").replace(/[€\s]/g, "");
  if (value.includes(",")) {
    value = value.replace(/\./g, "").replace(",", ".");
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Data delle operazioni "domani" (nell'Excel =OGGI()+1)
function tomorrowISO() {
  const domani = new Date();
  domani.setDate(domani.getDate() + 1);
  return `${domani.getFullYear()}-${String(domani.getMonth() + 1).padStart(2, "0")}-${String(domani.getDate()).padStart(2, "0")}`;
}

function normalize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function categoriaById(id) {
  return state.categorie.find((categoria) => categoria.id === id) || null;
}

// Categorie di un tipo; nelle tendine si nascondono quelle della banca già mappate
// su un'altra (es. "Farmacia"), che il database sostituisce comunque da solo
function categorieDelTipo(tipo, includiMappate = false) {
  const mappate = new Set(includiMappate ? [] : state.mappatura.map((riga) => riga.categoria_banca));
  return state.categorie
    .filter((categoria) => categoria.tipo === tipo && !mappate.has(categoria.nome))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

function showFeedback(message, type = "success") {
  clearTimeout(state.feedbackTimeoutId);
  elements.feedback.textContent = message;
  elements.feedback.className = `feedback feedback-${type}`;
  state.feedbackTimeoutId = setTimeout(() => elements.feedback.classList.add("hidden"), type === "error" ? 10000 : 4000);
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function createSupabaseClient() {
  const { supabaseUrl, supabaseKey } = window.APP_CONFIG || {};
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL o chiave mancante in assets/config.js.");
  }
  return window.supabase.createClient(supabaseUrl, supabaseKey);
}

// Supabase restituisce al massimo 1000 righe per richiesta: legge a pagine.
async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

async function loadYears() {
  const { data, error } = await state.supabase.from("movimenti").select("data").order("data").limit(1);
  if (error) throw error;
  const currentYear = new Date().getFullYear();
  const firstYear = data.length ? Number(data[0].data.slice(0, 4)) : currentYear;
  state.years = [];
  for (let year = currentYear; year >= firstYear; year -= 1) {
    state.years.push(year);
  }
}

async function loadData() {
  if (state.year === undefined) state.year = state.years[0]; // di default l'anno più recente
  const aggregatiQuery = () => {
    const query = state.supabase
      .from("movimenti")
      .select("anno,mese,categoria_id,importo.sum(),id.count()")
      .order("anno")
      .order("mese");
    return state.year === null ? query : query.eq("anno", state.year);
  };
  const numero = (v) => (v === null || v === undefined ? null : Number(v));
  const [categorie, aggregati, budget, saldi, investimenti, mappatura, riepiloghi] = await Promise.all([
    fetchAll(() => state.supabase.from("categorie").select("*").order("id")),
    fetchAll(aggregatiQuery),
    fetchAll(() => state.supabase.from("budget").select("*").order("id")),
    fetchAll(() => state.supabase.from("saldi").select("*").order("anno")),
    fetchAll(() => state.supabase.from("investimenti").select("*").order("data").order("id")),
    fetchAll(() => state.supabase.from("mappatura_categorie").select("*").order("categoria_banca")),
    fetchAll(() => state.supabase.from("riepiloghi_annuali").select("*").order("anno"))
  ]);

  // Quotazioni a parte: se la tabella non c'è ancora il resto del sito funziona lo stesso
  const quotazioni = await state.supabase.from("quotazioni").select("*");
  state.quotazioni = new Map((quotazioni.data || []).map((q) => [q.posizione, {
    ...q,
    prezzo: numero(q.prezzo),
    quote: numero(q.quote),
    costo: numero(q.costo),
    valore: numero(q.valore),
    plusvalenza: numero(q.plusvalenza)
  }]));

  // Conto Intesa a oggi (saldo a inizio anno + movimenti dell'anno) e uscite del mese in corso
  // per categoria, indipendenti dall'anno scelto nella Dashboard
  const adesso = new Date();
  const [movimentiAnno, usciteMese] = await Promise.all([
    state.supabase.from("movimenti").select("importo.sum()").eq("anno", adesso.getFullYear()),
    state.supabase.from("movimenti").select("categoria_id,importo.sum()")
      .eq("anno", adesso.getFullYear()).eq("mese", adesso.getMonth() + 1).lt("importo", 0)
  ]);
  if (movimentiAnno.error) throw movimentiAnno.error;
  if (usciteMese.error) throw usciteMese.error;
  const saldoInizio = saldi.find((s) => s.anno === adesso.getFullYear());
  state.contoOggi = saldoInizio ? round2(Number(saldoInizio.saldo_iniziale) + Number(movimentiAnno.data[0]?.sum || 0)) : null;
  state.usciteMese = usciteMese.data.map((r) => ({ categoria_id: r.categoria_id, speso: -Number(r.sum) }));

  // Conto Fineco: totali per tipo sommati dal database (anche questa tabella è facoltativa)
  const fineco = await state.supabase.from("movimenti_fineco").select("tipo,importo.sum(),data.max()");
  const perTipo = fineco.data || [];
  state.fineco = !perTipo.length ? null : {
    tipi: new Map(perTipo.map((r) => [r.tipo, Number(r.sum)])),
    liquidita: round2(perTipo.reduce((s, r) => s + Number(r.sum), 0)),
    ultimaData: perTipo.map((r) => r.max).sort().at(-1)
  };
  // Costi (bollo, Tobin tax, imposte) e interessi sulla liquidità del conto Fineco: non sono
  // operazioni del registro (non appartengono a una posizione) ma si vedono accanto a esse,
  // in sola lettura, e contano nei totali e nel grafico degli investimenti
  const costi = await state.supabase.from("movimenti_fineco").select("*").in("tipo", ["Costi", "Interessi"]).order("data");
  state.costiFineco = (costi.data || []).map((r) => ({
    id: `fineco-${r.id}`, fineco: true, posizione: null, data: r.data, nome: r.descrizione, tipo: "Conto Fineco",
    operazione: r.tipo === "Costi" ? "Costi e tasse" : "Interessi liquidità",
    quantita: null, abp: null, importo: Number(r.importo), note: r.descrizione_completa, domani: false
  }));

  // Watchlist senza lo storico (pesante: si carica solo per il grafico di un titolo)
  const watchlist = await state.supabase.from("watchlist").select(COLONNE_WATCHLIST);
  state.watchlist = (watchlist.data || []).map((t) => ({
    ...t,
    prezzo: numero(t.prezzo),
    prezzo_eur: numero(t.prezzo_eur),
    sma200: numero(t.sma200),
    sconto: numero(t.sconto),
    var_1m: numero(t.var_1m),
    var_1a: numero(t.var_1a),
    rsi: numero(t.rsi),
    rendimento_div: numero(t.rendimento_div),
    volatilita: numero(t.volatilita)
  }));

  state.categorie = categorie;
  state.mappatura = mappatura;
  state.aggregati = aggregati.map((riga) => ({
    anno: riga.anno,
    mese: riga.mese,
    categoria_id: riga.categoria_id,
    somma: Number(riga.sum),
    operazioni: Number(riga.count)
  }));
  state.budget = budget.map((riga) => ({ ...riga, importo_mensile: Number(riga.importo_mensile) }));
  state.saldi = new Map(saldi.map((riga) => [riga.anno, Number(riga.saldo_iniziale)]));
  state.riepiloghi = new Map(riepiloghi.map((riga) => [riga.anno, {
    mesi: numero(riga.mesi_lavorati),
    entrate: numero(riga.entrate),
    uscite: numero(riga.uscite)
  }]));
  state.investimenti = investimenti.map((riga) => ({
    ...riga,
    data: riga.domani ? tomorrowISO() : riga.data,
    importo: Number(riga.importo),
    quantita: riga.quantita === null ? null : Number(riga.quantita),
    abp: riga.abp == null ? null : Number(riga.abp)
  }));
}

async function reload() {
  try {
    await loadYears();
    await loadData();
  } catch (error) {
    console.error(error);
    showFeedback(`Errore nel caricamento: ${error.message}`, "error");
    return;
  }
  renderAll();
  await loadMovimentiPage(true);
}

// ---------------------------------------------------------------------------
// Movimenti
// ---------------------------------------------------------------------------

function renderYearSelect() {
  for (const select of elements.yearSelects) {
    select.innerHTML = state.years.map((year) => `<option value="${year}">${year}</option>`).join("")
      + '<option value="">Tutti gli anni</option>';
    select.value = state.year === null ? "" : String(state.year);
  }
}

function categoryOptions(tipo) {
  return categorieDelTipo(tipo)
    .map((categoria) => `<option value="${categoria.id}">${escapeHtml(categoria.nome)}</option>`)
    .join("");
}

function renderFilters() {
  const anno = elements.filterAnno.value;
  const mese = elements.filterMese.value;
  const categoria = elements.filterCategoria.value;
  elements.filterAnno.innerHTML = '<option value="">Tutti gli anni</option>'
    + state.years.map((year) => `<option value="${year}">${year}</option>`).join("");
  elements.filterMese.innerHTML = '<option value="">Tutti i mesi</option>'
    + MESI.map((nome, index) => `<option value="${index}">${nome}</option>`).join("");
  elements.filterCategoria.innerHTML = `
    <option value="">Tutte le categorie</option>
    <optgroup label="Uscite">${categoryOptions("uscita")}</optgroup>
    <optgroup label="Entrate">${categoryOptions("entrata")}</optgroup>
    <option value="nessuna">Senza categoria</option>
    <option value="senza-budget">Uscite senza budget</option>`;
  elements.filterAnno.value = anno;
  elements.filterMese.value = mese;
  elements.filterCategoria.value = categoria;
}

// Applica i filtri alla query: vengono calcolati dal database su tutti i movimenti
function applyFilters(query) {
  const anno = elements.filterAnno.value;
  const mese = elements.filterMese.value;
  const categoria = elements.filterCategoria.value;
  // Virgole, parentesi e asterischi hanno un significato nei filtri di Supabase
  const testo = elements.filterTesto.value.replace(/[,()*%\\]/g, " ").trim();
  if (anno) query = query.gte("data", `${anno}-01-01`).lte("data", `${anno}-12-31`);
  if (mese !== "") query = query.eq("mese", Number(mese) + 1);
  if (categoria === "nessuna") query = query.is("categoria_id", null);
  else if (categoria === "senza-budget") {
    // Uscite la cui categoria non ha budget nell'anno del movimento (come la colonna Budget)
    const parti = (anno ? [Number(anno)] : state.years).map((a) => {
      const ids = categorieDelTipo("uscita").filter((c) => budgetFor(c.id, a) === null).map((c) => c.id);
      return ids.length ? `and(anno.eq.${a},categoria_id.in.(${ids.join(",")}))` : null;
    }).filter(Boolean);
    query = parti.length ? query.or(parti.join(",")).lt("importo", 0) : query.eq("id", -1);
  }
  else if (categoria) query = query.eq("categoria_id", Number(categoria));
  if (testo) query = query.or(`operazione.ilike.*${testo}*,dettagli.ilike.*${testo}*,categoria.ilike.*${testo}*,note.ilike.*${testo}*`);
  return query;
}

// Carica la pagina successiva della lista (reset = ricomincia dopo un cambio filtri)
async function loadMovimentiPage(reset = false) {
  const lista = state.lista;
  if (reset) {
    lista.righe = [];
    lista.finita = false;
    lista.caricamento = false;
    lista.richiesta += 1;
    renderMovimenti();
    loadTotali();
  }
  if (lista.caricamento || lista.finita) return;
  const richiesta = lista.richiesta;
  lista.caricamento = true;
  const from = lista.righe.length;
  const { colonna, crescente } = state.ordinamento;
  const { data, error } = await applyFilters(state.supabase.from("movimenti").select("*"))
    .order(colonna, { ascending: crescente, nullsFirst: false })
    .order("id", { ascending: crescente })
    .range(from, from + LISTA_PAGINA - 1);
  if (richiesta !== lista.richiesta) return; // i filtri sono cambiati nel frattempo
  lista.caricamento = false;
  if (error) {
    showFeedback(`Errore nel caricamento dei movimenti: ${error.message}`, "error");
    return;
  }
  lista.righe.push(...data.map((movimento) => ({ ...movimento, importo: Number(movimento.importo) })));
  lista.finita = data.length < LISTA_PAGINA;
  renderMovimenti();
}

async function loadTotali() {
  const richiesta = state.lista.richiesta;
  const somma = () => applyFilters(state.supabase.from("movimenti").select("importo.sum()"));
  const [conteggio, entrate, uscite] = await Promise.all([
    applyFilters(state.supabase.from("movimenti").select("id", { count: "exact", head: true })),
    somma().gt("importo", 0),
    somma().lt("importo", 0)
  ]);
  if (richiesta !== state.lista.richiesta) return;
  const errore = conteggio.error || entrate.error || uscite.error;
  if (errore) {
    elements.totali.textContent = `Totali non disponibili: ${errore.message}`;
    return;
  }
  const totEntrate = Number(entrate.data[0]?.sum || 0);
  const totUscite = -Number(uscite.data[0]?.sum || 0);
  elements.totali.innerHTML = `${conteggio.count} movimenti ·
    entrate <strong class="positive">${formatEuro(totEntrate)}</strong> ·
    uscite <strong class="negative">${formatEuro(totUscite)}</strong> ·
    saldo <strong>${formatEuro(totEntrate - totUscite)}</strong>`;
}

// Quando la fine della lista entra nello schermo, carica altri movimenti
const listaObserver = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting) && !elements.viewMovimenti.classList.contains("hidden")) {
    loadMovimentiPage();
  }
}, { rootMargin: "400px" });

function watchListaFine() {
  // Riosservare fa ripartire il controllo anche se la fine è già visibile
  listaObserver.unobserve(elements.listaFine);
  listaObserver.observe(elements.listaFine);
}

// Budget mensile della categoria nell'anno del movimento, come la colonna "Budget" dell'Excel:
// rosso se il movimento da solo supera il budget, giallo se la categoria non ha budget
function cellaBudget(movimento) {
  const categoria = categoriaById(movimento.categoria_id);
  if (!categoria || categoria.tipo !== "uscita") return '<td data-label="Budget" class="num"></td>';
  const budget = budgetFor(categoria.id, Number(movimento.data.slice(0, 4)));
  if (budget === null) {
    return '<td data-label="Budget" class="num no-budget" title="Categoria senza budget: forse va mappata su un\'altra">nessuno</td>';
  }
  const over = -movimento.importo > budget;
  return `<td data-label="Budget" class="num ${over ? "over" : ""}" ${over ? 'title="Il movimento supera il budget mensile"' : ""}>${formatEuro(budget)}</td>`;
}

function renderMovimenti() {
  const lista = state.lista;
  if (!lista.righe.length) {
    elements.movimentiBody.innerHTML = `<tr><td colspan="7" class="empty">${lista.finita ? "Nessun movimento con questi filtri." : "Caricamento..."}</td></tr>`;
  } else {
    elements.movimentiBody.innerHTML = lista.righe.map((movimento) => (movimento.id === state.editingId ? rigaInModifica(movimento) : `
    <tr>
      <td data-label="Data">${formatDate(movimento.data)}</td>
      <td data-label="Operazione">
        <span class="operazione">${escapeHtml(movimento.operazione)}</span>
        ${movimento.dettagli ? `<span class="dettagli" title="${escapeHtml(movimento.dettagli)}">${escapeHtml(movimento.dettagli)}</span>` : ""}
      </td>
      <td data-label="Categoria">
        <button class="categoria-button" type="button" data-action="categoria" data-id="${movimento.id}" title="Cambia categoria">${escapeHtml(categoriaById(movimento.categoria_id)?.nome || "—")}</button>
      </td>
      <td data-label="Importo" class="num ${movimento.importo < 0 ? "negative" : "positive"}">${formatEuro(movimento.importo)}</td>
      ${cellaBudget(movimento)}
      <td data-label="Note">${escapeHtml(movimento.note || "")}</td>
      <td class="actions">
        <button class="icon-button" type="button" data-action="edit" data-id="${movimento.id}" title="Modifica" aria-label="Modifica">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="icon-button danger" type="button" data-action="delete" data-id="${movimento.id}" title="Elimina" aria-label="Elimina">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </td>
    </tr>`)).join("");
  }
  renderSortIndicators(elements.sortButtons, "sort", state.ordinamento);
  elements.listaFine.textContent = !lista.righe.length ? ""
    : lista.finita ? `Fine: ${lista.righe.length} movimenti mostrati.` : "Caricamento di altri movimenti...";
  if (!lista.finita) watchListaFine();
}

// Cambio categoria direttamente dalla riga: il nome diventa una tendina (solo su quella riga)
function apriSceltaCategoria(button, id) {
  const movimento = state.lista.righe.find((m) => m.id === id);
  if (!movimento) return;
  const opzioni = categorieDelTipo(movimento.importo < 0 ? "uscita" : "entrata");
  const corrente = categoriaById(movimento.categoria_id);
  if (corrente && !opzioni.includes(corrente)) opzioni.unshift(corrente);
  const select = document.createElement("select");
  select.className = "riga-categoria";
  select.setAttribute("aria-label", "Categoria");
  select.innerHTML = '<option value="">— Senza categoria</option>' + opzioni
    .map((c) => `<option value="${c.id}" ${c.id === movimento.categoria_id ? "selected" : ""}>${escapeHtml(c.nome)}</option>`)
    .join("");
  button.replaceWith(select);
  select.focus();
  try {
    select.showPicker();
  } catch {
    // browser senza showPicker: la tendina si apre al clic
  }
  select.addEventListener("change", () => salvaCategoriaRiga(select, movimento));
  select.addEventListener("blur", () => {
    if (!select.disabled) renderMovimenti();
  });
}

async function salvaCategoriaRiga(select, movimento) {
  select.disabled = true;
  const categoriaId = select.value ? Number(select.value) : null;
  const { data, error } = await state.supabase
    .from("movimenti")
    .update({ categoria_id: categoriaId })
    .eq("id", movimento.id)
    .select()
    .single();
  if (error) {
    showFeedback(`Categoria non salvata: ${error.message}`, "error");
    renderMovimenti();
    return;
  }
  state.lista.righe = state.lista.righe.map((m) => (m.id === movimento.id ? { ...m, ...data, importo: Number(data.importo) } : m));
  renderMovimenti();
  showFeedback(`Categoria di "${movimento.operazione}" aggiornata: ${categoriaById(data.categoria_id)?.nome || "senza categoria"}.`);
  // Aggiorna in background totali della dashboard e categorie (una categoria rimasta vuota viene cancellata)
  loadData().then(renderAll).catch((err) => console.error(err));
}

function onFiltriChange() {
  clearTimeout(state.filtroTimeoutId);
  state.filtroTimeoutId = setTimeout(() => loadMovimentiPage(true), 300);
}

// Riga in modifica (matita): data, operazione, dettagli, importo e note diventano campi
function rigaInModifica(movimento) {
  const campo = (nome, valore, extra = "", classe = "riga-input") =>
    `<input class="${classe}" data-campo="${nome}" value="${escapeHtml(valore ?? "")}" ${extra} autocomplete="off">`;
  return `
    <tr class="editing" data-id="${movimento.id}">
      <td data-label="Data">${campo("data", movimento.data, 'type="date" aria-label="Data"')}</td>
      <td data-label="Operazione">
        ${campo("operazione", movimento.operazione, 'type="text" aria-label="Operazione" placeholder="Operazione"')}
        ${campo("dettagli", movimento.dettagli, 'type="text" aria-label="Dettagli" placeholder="Dettagli"', "riga-input dettagli-input")}
      </td>
      <td data-label="Categoria">
        <button class="categoria-button" type="button" data-action="categoria" data-id="${movimento.id}" title="Cambia categoria">${escapeHtml(categoriaById(movimento.categoria_id)?.nome || "—")}</button>
      </td>
      <td data-label="Importo" class="num">${campo("importo", String(movimento.importo).replace(".", ","), 'type="text" inputmode="decimal" aria-label="Importo (negativo per le uscite)" title="Negativo per le uscite"')}</td>
      ${cellaBudget(movimento)}
      <td data-label="Note">${campo("note", movimento.note, 'type="text" aria-label="Note" placeholder="Note"')}</td>
      <td class="actions">
        <button class="icon-button" type="button" data-action="save" data-id="${movimento.id}" title="Salva (Invio)" aria-label="Salva">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </button>
        <button class="icon-button" type="button" data-action="cancel" data-id="${movimento.id}" title="Annulla (Esc)" aria-label="Annulla">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </td>
    </tr>`;
}

function startEdit(id) {
  state.editingId = id;
  renderMovimenti();
  elements.movimentiBody.querySelector('tr.editing [data-campo="operazione"]')?.focus();
}

function annullaModifica() {
  state.editingId = null;
  renderMovimenti();
}

async function salvaModifica(id) {
  const riga = elements.movimentiBody.querySelector(`tr.editing[data-id="${id}"]`);
  if (!riga) return;
  const valore = (nome) => riga.querySelector(`[data-campo="${nome}"]`).value.trim();
  const importo = parseAmount(valore("importo"));
  if (!valore("data")) return showFeedback("Data non valida.", "error");
  if (importo === null || importo === 0) return showFeedback("Importo non valido (negativo per le uscite).", "error");
  const record = {
    data: valore("data"),
    operazione: valore("operazione"),
    dettagli: valore("dettagli"),
    importo: round2(importo),
    note: valore("note") || null
  };
  const { data, error } = await state.supabase.from("movimenti").update(record).eq("id", id).select().single();
  if (error) return showFeedback(`Salvataggio non riuscito: ${error.message}`, "error");
  state.editingId = null;
  state.lista.righe = state.lista.righe.map((m) => (m.id === id ? { ...m, ...data, importo: Number(data.importo) } : m));
  renderMovimenti();
  showFeedback("Movimento aggiornato.");
  loadData().then(renderAll).catch((err) => console.error(err));
  loadTotali();
}

// Freccette nelle intestazioni ordinabili
function renderSortIndicators(buttons, attributo, ordinamento) {
  for (const button of buttons) {
    const attiva = button.dataset[attributo] === ordinamento.colonna;
    button.classList.toggle("active", attiva);
    button.querySelector(".sort-indicator").textContent = attiva ? (ordinamento.crescente ? "↑" : "↓") : "↕";
    button.closest("th").setAttribute("aria-sort", attiva ? (ordinamento.crescente ? "ascending" : "descending") : "none");
  }
}

// Clic su un'intestazione: ordina per quella colonna, secondo clic inverte
function cambiaOrdinamento(ordinamento, colonna) {
  if (ordinamento.colonna === colonna) ordinamento.crescente = !ordinamento.crescente;
  else {
    ordinamento.colonna = colonna;
    ordinamento.crescente = !["data", "importo"].includes(colonna); // date e importi: prima i più recenti/grandi
  }
}

async function deleteMovimento(id) {
  const movimento = state.lista.righe.find((m) => m.id === id);
  if (!movimento || !confirm(`Eliminare "${movimento.operazione}" del ${formatDate(movimento.data)}?`)) return;
  const { error } = await state.supabase.from("movimenti").delete().eq("id", id);
  if (error) {
    showFeedback(`Eliminazione non riuscita: ${error.message}`, "error");
    return;
  }
  if (state.editingId === id) state.editingId = null;
  showFeedback("Movimento eliminato.");
  await reload();
}

// ---------------------------------------------------------------------------
// Import da Excel ("+ Excel"): estratto conto della banca o file Portafogli.
// Stesse regole di import_excel.py: un movimento già presente (stessa data,
// importo, operazione e dettagli) viene saltato; le categorie della banca
// passano dalla mappatura salvata nel database.
// ---------------------------------------------------------------------------

const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

// La libreria per leggere gli Excel si carica solo quando serve
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_URL;
    script.onload = resolve;
    script.onerror = () => reject(new Error("impossibile caricare la libreria per leggere gli Excel"));
    document.head.append(script);
  });
}

// Data di una cella: numero seriale di Excel oppure testo "gg/mm/aaaa"
function excelDate(value) {
  if (typeof value === "number") {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}

function chiaveMovimento(data, importo, operazione, dettagli) {
  return `${data}|${Number(importo).toFixed(2)}|${String(operazione || "").trim().toLowerCase()}|${String(dettagli || "").trim().toLowerCase()}`;
}

// Legge le righe sotto l'intestazione (Data, Operazione, Dettagli, Categoria, Importo, Note)
function leggiTabella(righe, rigaIntestazione, tipoFoglio = null) {
  const intestazione = righe[rigaIntestazione].map((cella) => String(cella ?? "").trim().toLowerCase());
  const valore = (riga, nome) => (intestazione.includes(nome) ? riga[intestazione.indexOf(nome)] : null);
  const testo = (v) => String(v ?? "").trim();
  return righe.slice(rigaIntestazione + 1).map((riga) => {
    const data = excelDate(valore(riga, "data"));
    const grezzo = valore(riga, "importo");
    const importo = typeof grezzo === "number" ? grezzo : parseAmount(grezzo);
    if (!data || importo === null || importo === 0) return null;
    return {
      data,
      operazione: testo(valore(riga, "operazione")),
      dettagli: testo(valore(riga, "dettagli")),
      categoriaBanca: testo(valore(riga, "categoria")),
      tipo: tipoFoglio || (importo < 0 ? "uscita" : "entrata"),
      importo: round2(importo),
      note: testo(valore(riga, "note")) || null
    };
  }).filter(Boolean);
}

function leggiWorkbook(workbook) {
  const { utils } = window.XLSX;
  const righe = (nome) => {
    const sheet = workbook.Sheets[nome];
    // Alcuni export (es. Intesa) dichiarano meno righe di quelle reali: ricalcola l'intervallo dalle celle
    const celle = Object.keys(sheet).filter((k) => !k.startsWith("!")).map((k) => utils.decode_cell(k));
    if (celle.length) {
      const fine = { r: Math.max(...celle.map((c) => c.r)), c: Math.max(...celle.map((c) => c.c)) };
      sheet["!ref"] = utils.encode_range({ s: { r: 0, c: 0 }, e: fine });
    }
    return utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  };
  // File Portafogli: fogli "Uscite" ed "Entrate"
  const fogli = [["Uscite", "uscita"], ["Entrate", "entrata"]].filter(([nome]) => workbook.SheetNames.includes(nome));
  if (fogli.length) return fogli.flatMap(([nome, tipo]) => leggiTabella(righe(nome), 0, tipo));
  // Estratto conto: intestazione con "Data" e "Importo" nelle prime 40 righe
  const primo = righe(workbook.SheetNames[0]);
  const indice = primo.slice(0, 40).findIndex((riga) => {
    const nomi = riga.map((cella) => String(cella ?? "").trim().toLowerCase());
    return nomi.includes("data") && nomi.includes("importo");
  });
  return indice === -1 ? [] : leggiTabella(primo, indice);
}

// Categoria mia per una categoria della banca: mappatura, poi stesso nome; undefined = da decidere
function risolviCategoria(nome, tipo) {
  if (!nome) return null;
  const mappata = state.mappatura.find((riga) => riga.categoria_banca === nome);
  if (mappata) return mappata.categoria_id;
  return state.categorie.find((c) => c.nome === nome && c.tipo === tipo)?.id;
}

async function handleExcelFile(file) {
  elements.excelInput.value = "";
  if (!file) return;
  elements.excelButton.disabled = true;
  try {
    await loadSheetJS();
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const movimenti = leggiWorkbook(workbook);
    if (!movimenti.length) {
      showFeedback("Nessun movimento trovato: serve una riga di intestazione con almeno \"Data\" e \"Importo\".", "error");
      return;
    }
    const date = movimenti.map((m) => m.data).sort();
    const esistenti = await fetchAll(() => state.supabase
      .from("movimenti")
      .select("data,importo,operazione,dettagli")
      .gte("data", date[0])
      .lte("data", date[date.length - 1])
      .order("id"));
    // I doppioni veri si contano: 2 righe uguali nel file e 1 nel database -> se ne aggiunge 1
    const presenti = new Map();
    for (const r of esistenti) {
      const key = chiaveMovimento(r.data, r.importo, r.operazione, r.dettagli);
      presenti.set(key, (presenti.get(key) || 0) + 1);
    }
    const nuovi = movimenti.filter((m) => {
      const key = chiaveMovimento(m.data, m.importo, m.operazione, m.dettagli);
      if (!presenti.get(key)) return true;
      presenti.set(key, presenti.get(key) - 1);
      return false;
    });
    const daDecidere = new Map();
    for (const m of nuovi) {
      if (risolviCategoria(m.categoriaBanca, m.tipo) !== undefined) continue;
      const voce = daDecidere.get(m.categoriaBanca) || { tipo: m.tipo, conteggio: 0 };
      voce.conteggio += 1;
      daDecidere.set(m.categoriaBanca, voce);
    }
    state.importazione = { nomeFile: file.name, totale: movimenti.length, dal: date[0], al: date[date.length - 1], nuovi, daDecidere };
    renderImportPanel();
  } catch (error) {
    console.error(error);
    showFeedback(`File non letto: ${error.message}`, "error");
  } finally {
    elements.excelButton.disabled = false;
  }
}

function opzioniCategorie(selezionata = "") {
  const gruppo = (tipo, etichetta) => `<optgroup label="${etichetta}">${categorieDelTipo(tipo)
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(selezionata) ? "selected" : ""}>${escapeHtml(c.nome)}</option>`)
    .join("")}</optgroup>`;
  return gruppo("uscita", "Uscite") + gruppo("entrata", "Entrate");
}

function renderImportPanel() {
  const imp = state.importazione;
  if (!imp) {
    elements.importPanel.classList.add("hidden");
    return;
  }
  const entrate = imp.nuovi.filter((m) => m.importo > 0).reduce((sum, m) => sum + m.importo, 0);
  const uscite = imp.nuovi.filter((m) => m.importo < 0).reduce((sum, m) => sum - m.importo, 0);
  const decisioni = [...imp.daDecidere.entries()].map(([nome, voce]) => `
    <tr>
      <td>${escapeHtml(nome)}</td>
      <td>${voce.tipo}</td>
      <td class="num">${voce.conteggio}</td>
      <td>
        <select class="import-scelta" data-categoria-banca="${escapeHtml(nome)}" aria-label="Categoria per ${escapeHtml(nome)}">
          <option value="nuova">Crea la categoria "${escapeHtml(nome)}"</option>
          ${opzioniCategorie()}
        </select>
      </td>
    </tr>`).join("");
  const nomeCategoria = (m) => {
    const id = risolviCategoria(m.categoriaBanca, m.tipo);
    if (id === null) return "—";
    if (id === undefined) return `<em>${escapeHtml(m.categoriaBanca)}</em>`;
    return escapeHtml(categoriaById(id)?.nome || "?");
  };
  elements.importPanel.innerHTML = `
    <h2>Importazione da "${escapeHtml(imp.nomeFile)}"</h2>
    <p>${imp.totale} movimenti nel file (dal ${formatDate(imp.dal)} al ${formatDate(imp.al)}):
      <strong>${imp.nuovi.length} nuovi</strong>, ${imp.totale - imp.nuovi.length} già presenti (saltati).
      Nuove entrate <strong class="positive">${formatEuro(entrate)}</strong>, nuove uscite <strong class="negative">${formatEuro(uscite)}</strong>.</p>
    <p class="controllo-saldo">
      <label>Controllo (facoltativo): saldo contabile di oggi nell'app Intesa
        <input id="import-saldo" type="text" inputmode="decimal" placeholder="es. 1.234,56" autocomplete="off"> €</label>
      <span id="import-saldo-esito" class="hint"></span>
    </p>
    ${imp.daDecidere.size ? `
      <p class="hint">Categorie della banca senza corrispondenza: scegli a quale tua categoria associarle.
        La scelta viene salvata nella mappatura e usata anche le prossime volte.</p>
      <div class="table-wrap"><table class="summary-table">
        <thead><tr><th>Categoria della banca</th><th>Tipo</th><th class="num">Movimenti</th><th>Mia categoria</th></tr></thead>
        <tbody>${decisioni}</tbody>
      </table></div>` : ""}
    ${imp.nuovi.length ? `
      <details>
        <summary>Vedi i ${imp.nuovi.length} movimenti che verranno aggiunti</summary>
        <div class="table-wrap import-preview"><table class="summary-table">
          <thead><tr><th>Data</th><th>Operazione</th><th>Categoria</th><th class="num">Importo</th></tr></thead>
          <tbody>${imp.nuovi.map((m) => `
            <tr><td>${formatDate(m.data)}</td><td>${escapeHtml(m.operazione)}</td><td>${nomeCategoria(m)}</td>
            <td class="num ${m.importo < 0 ? "negative" : "positive"}">${formatNumber(m.importo)}</td></tr>`).join("")}
          </tbody>
        </table></div>
      </details>` : ""}
    <div class="box-actions">
      ${imp.nuovi.length ? `<button id="import-confirm" class="primary-button" type="button">Importa ${imp.nuovi.length} movimenti</button>` : ""}
      <button id="import-cancel" class="secondary-button" type="button">${imp.nuovi.length ? "Annulla" : "Chiudi"}</button>
    </div>`;
  elements.importPanel.classList.remove("hidden");
  elements.importPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Saldo del conto dopo l'import (saldo a inizio anno + movimenti dell'anno + quelli nuovi
// dell'anno nel file) confrontato con quello scritto dall'app Intesa: una differenza vuol dire
// movimenti mancanti o doppi
function controllaSaldoImport() {
  const scritto = parseAmount(document.querySelector("#import-saldo").value);
  const esito = document.querySelector("#import-saldo-esito");
  if (scritto === null || document.querySelector("#import-saldo").value.trim() === "") {
    esito.textContent = "";
    return;
  }
  if (state.contoOggi === null) {
    esito.innerHTML = '<span class="negative">manca il saldo a inizio anno: non posso confrontare</span>';
    return;
  }
  const anno = String(new Date().getFullYear());
  const nuovi = state.importazione.nuovi.filter((m) => m.data.startsWith(anno)).reduce((s, m) => s + m.importo, 0);
  const calcolato = round2(state.contoOggi + nuovi);
  const differenza = round2(scritto - calcolato);
  esito.innerHTML = Math.abs(differenza) < 0.01
    ? `<span class="positive">✓ uguale al saldo calcolato (${formatEuro(calcolato)})</span>`
    : `<span class="negative">saldo calcolato ${formatEuro(calcolato)}: differenza ${formatEuro(differenza)}
        (${differenza > 0 ? "mancano entrate o ci sono uscite di troppo" : "mancano uscite o ci sono entrate di troppo"};
        controlla anche i movimenti non ancora contabilizzati)</span>`;
}

async function confermaImportazione() {
  const imp = state.importazione;
  const bottone = document.querySelector("#import-confirm");
  bottone.disabled = true;
  bottone.textContent = "Importazione...";
  try {
    // 1. Scelte per le categorie della banca sconosciute: nuova categoria o mappatura
    for (const select of elements.importPanel.querySelectorAll(".import-scelta")) {
      const nome = select.dataset.categoriaBanca;
      const tipo = imp.daDecidere.get(nome).tipo;
      if (select.value === "nuova") {
        const { data, error } = await state.supabase.from("categorie").insert({ nome, tipo }).select().single();
        if (error) throw error;
        state.categorie.push(data);
      } else {
        const { data, error } = await state.supabase
          .from("mappatura_categorie")
          .insert({ categoria_banca: nome, categoria_id: Number(select.value) })
          .select()
          .single();
        if (error) throw error;
        state.mappatura.push(data);
      }
    }
    // 2. Movimenti, a blocchi di 500
    const righe = imp.nuovi.map((m) => ({
      data: m.data,
      operazione: m.operazione,
      dettagli: m.dettagli,
      categoria_id: risolviCategoria(m.categoriaBanca, m.tipo) ?? null,
      importo: m.importo,
      note: m.note
    }));
    for (let i = 0; i < righe.length; i += 500) {
      const { error } = await state.supabase.from("movimenti").insert(righe.slice(i, i + 500));
      if (error) throw error;
    }
    showFeedback(`Importati ${righe.length} movimenti da "${imp.nomeFile}".`);
    state.importazione = null;
    renderImportPanel();
    await reload();
  } catch (error) {
    console.error(error);
    showFeedback(`Importazione non riuscita: ${error.message}`, "error");
    bottone.disabled = false;
    bottone.textContent = `Importa ${imp.nuovi.length} movimenti`;
  }
}

// ---------------------------------------------------------------------------
// Mappatura categorie (categoria della banca -> mia categoria), modificabile
// ---------------------------------------------------------------------------

function renderMappatura() {
  const righe = [...state.mappatura].sort((a, b) => a.categoria_banca.localeCompare(b.categoria_banca, "it"));
  elements.mappaturaPanel.innerHTML = `
    <h2>Mappatura categorie</h2>
    <p class="hint">Quando importi un estratto conto, ogni categoria della banca a sinistra diventa la tua categoria a destra.
      Le categorie della banca che hanno già lo stesso nome di una tua non servono qui.
      Il database applica la mappatura da solo ai movimenti la cui categoria non ha budget nel loro anno:
      a quelli nuovi e, quando aggiungi o cambi una voce, anche a quelli già presenti.</p>
    <div class="table-wrap"><table class="summary-table">
      <thead><tr><th>Categoria della banca</th><th>Mia categoria</th><th></th></tr></thead>
      <tbody>
        ${righe.map((riga) => `
          <tr>
            <td>${escapeHtml(riga.categoria_banca)}</td>
            <td><select class="mappatura-select" data-id="${riga.id}" aria-label="Mia categoria">${opzioniCategorie(riga.categoria_id)}</select></td>
            <td class="actions">
              <button class="icon-button danger" type="button" data-action="mappatura-delete" data-id="${riga.id}" title="Elimina" aria-label="Elimina">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </td>
          </tr>`).join("") || '<tr><td colspan="3" class="empty">Nessuna mappatura.</td></tr>'}
      </tbody>
      <tfoot>
        <tr>
          <td><input id="mappatura-nuova-banca" type="text" placeholder="Categoria della banca" autocomplete="off"></td>
          <td><select id="mappatura-nuova-categoria" aria-label="Mia categoria">${opzioniCategorie()}</select></td>
          <td class="actions"><button id="mappatura-add" class="primary-button" type="button">Aggiungi</button></td>
        </tr>
      </tfoot>
    </table></div>
    <div class="box-actions"><button id="mappatura-close" class="secondary-button" type="button">Chiudi</button></div>`;
}

async function handleMappaturaClick(event) {
  const target = event.target;
  if (target.id === "mappatura-close") {
    elements.mappaturaPanel.classList.add("hidden");
    return;
  }
  if (target.id === "mappatura-add") {
    const nome = document.querySelector("#mappatura-nuova-banca").value.trim();
    const categoriaId = Number(document.querySelector("#mappatura-nuova-categoria").value);
    if (!nome) return showFeedback("Scrivi il nome della categoria della banca.", "error");
    const { data, error } = await state.supabase
      .from("mappatura_categorie")
      .insert({ categoria_banca: nome, categoria_id: categoriaId })
      .select()
      .single();
    if (error) return showFeedback(`Mappatura non salvata: ${error.message}`, "error");
    state.mappatura.push(data);
    showFeedback(`Mappatura salvata: i movimenti di "${nome}" senza budget sono stati spostati.`);
    await reload();
    renderMappatura();
    return;
  }
  const button = target.closest('button[data-action="mappatura-delete"]');
  if (button) {
    const id = Number(button.dataset.id);
    const { error } = await state.supabase.from("mappatura_categorie").delete().eq("id", id);
    if (error) return showFeedback(`Mappatura non eliminata: ${error.message}`, "error");
    state.mappatura = state.mappatura.filter((riga) => riga.id !== id);
    renderMappatura();
  }
}

async function handleMappaturaChange(event) {
  if (!event.target.matches(".mappatura-select")) return;
  const id = Number(event.target.dataset.id);
  const categoriaId = Number(event.target.value);
  const { error } = await state.supabase.from("mappatura_categorie").update({ categoria_id: categoriaId }).eq("id", id);
  if (error) return showFeedback(`Mappatura non salvata: ${error.message}`, "error");
  state.mappatura = state.mappatura.map((riga) => (riga.id === id ? { ...riga, categoria_id: categoriaId } : riga));
  showFeedback("Mappatura salvata: i movimenti corrispondenti senza budget sono stati spostati.");
  await reload();
  renderMappatura();
}

// ---------------------------------------------------------------------------
// Dashboard: Uscite come la "Dashboard Riassuntiva", Entrate come la "Dashboard Entrate"
//
// I totali arrivano già sommati dal database per anno, mese e categoria
// (state.aggregati), per l'anno scelto o per tutti gli anni (state.year = null).
// Con un anno: colonne = 12 mesi. Con tutti gli anni: tabelle per anno,
// grafici mese per mese dal primo all'ultimo mese con dati.
// ---------------------------------------------------------------------------

function tuttiGliAnni() {
  return state.year === null;
}

function tipoAggregato(riga) {
  return categoriaById(riga.categoria_id)?.tipo || (riga.somma < 0 ? "uscita" : "entrata");
}

// Periodi: [{ key, label, anno, mese }]; mese null = anno intero
function periodi(perGrafico) {
  if (!tuttiGliAnni()) {
    // Con un solo anno l'anno è già nel filtro: le etichette sono solo i mesi
    return MESI.map((nome, i) => ({ key: `${state.year}-${i + 1}`, label: nome, anno: state.year, mese: i + 1 }));
  }
  const anni = [...new Set(state.aggregati.map((r) => r.anno))].sort((a, b) => a - b);
  if (!perGrafico) return anni.map((anno) => ({ key: String(anno), label: String(anno), anno, mese: null }));
  const lista = [];
  for (const anno of anni) {
    const mesi = state.aggregati.filter((r) => r.anno === anno).map((r) => r.mese);
    // L'ultimo anno arriva almeno al mese in corso (anche senza movimenti), per la linea di oggi
    const meseInCorso = anno === new Date().getFullYear() ? new Date().getMonth() + 1 : 0;
    const ultimo = anno === anni[anni.length - 1] ? Math.max(...mesi, meseInCorso) : 12;
    const primo = anno === anni[0] ? Math.min(...mesi) : 1;
    for (let mese = primo; mese <= ultimo; mese += 1) {
      lista.push({ key: `${anno}-${mese}`, label: `${MESI[mese - 1]} ${anno}`, anno, mese });
    }
  }
  return lista;
}

function chiavePeriodo(riga, elenco) {
  return elenco[0]?.mese === null ? String(riga.anno) : `${riga.anno}-${riga.mese}`;
}

// Budget di una categoria per un anno: quello dell'anno o dell'ultimo anno precedente con budget
// Un budget a 0 vale come "nessun budget" (le righe a 0 le crea il database per le nuove categorie)
function budgetValidi() {
  return state.budget.filter((riga) => riga.importo_mensile > 0);
}

function budgetYear(anno = state.year) {
  const anni = budgetValidi().map((riga) => riga.anno).filter((a) => a <= anno);
  return anni.length ? Math.max(...anni) : null;
}

function budgetFor(categoriaId, anno = state.year) {
  const annoBudget = budgetYear(anno);
  // Se l'anno ha una riga per la categoria vale quella (0 = nessun budget)
  const riga = state.budget.find((r) => r.categoria_id === categoriaId && r.anno === annoBudget);
  if (riga) return riga.importo_mensile > 0 ? riga.importo_mensile : null;
  // Anni in cui la categoria non era ancora nel budget: vale il primo budget successivo
  const successivo = budgetValidi()
    .filter((r) => r.categoria_id === categoriaId && r.anno > anno)
    .sort((a, b) => a.anno - b.anno)[0];
  return successivo ? successivo.importo_mensile : null;
}

// Media sulle sole colonne con importo, come AVERAGEIF(..., "<>0") nell'Excel
function mediaMesiAttivi(valori) {
  const attivi = valori.filter((valore) => valore !== 0);
  return attivi.length ? attivi.reduce((sum, v) => sum + v, 0) / attivi.length : 0;
}

function cell(value, extraClass = "") {
  return `<td class="num ${extraClass}">${value ? formatNumber(value) : '<span class="zero">—</span>'}</td>`;
}

function periodHeader(firstLabel, elenco, extra = []) {
  return `<thead><tr><th>${firstLabel}</th>${elenco.map((p) => `<th class="num">${p.label}</th>`).join("")}${extra.map((e) => `<th class="num">${e}</th>`).join("")}</tr></thead>`;
}

// Totali per categoria e periodo: Map(categoria_id | "nessuna" -> { valori, operazioni })
function totalsByCategory(tipo, elenco) {
  const indice = new Map(elenco.map((p, i) => [p.key, i]));
  const rows = new Map();
  for (const riga of state.aggregati) {
    if (tipoAggregato(riga) !== tipo) continue;
    const i = indice.get(chiavePeriodo(riga, elenco));
    if (i === undefined) continue;
    const key = riga.categoria_id || "nessuna";
    if (!rows.has(key)) rows.set(key, { valori: Array(elenco.length).fill(0), operazioni: 0 });
    const row = rows.get(key);
    row.valori[i] = round2(row.valori[i] + (tipo === "uscita" ? -riga.somma : riga.somma));
    row.operazioni += riga.operazioni;
  }
  return rows;
}

// Entrate, uscite, risparmio e saldo del conto per periodo
function andamento(elenco) {
  const indice = new Map(elenco.map((p, i) => [p.key, i]));
  const entrate = Array(elenco.length).fill(0);
  const uscite = Array(elenco.length).fill(0);
  let ultimo = -1;
  for (const riga of state.aggregati) {
    const i = indice.get(chiavePeriodo(riga, elenco));
    if (i === undefined) continue;
    ultimo = Math.max(ultimo, i);
    if (tipoAggregato(riga) === "uscita") uscite[i] -= riga.somma;
    else entrate[i] += riga.somma;
  }
  // Anni senza movimenti (2021, 2022): entrate e uscite dal foglio "Pre 2023"
  // (nel grafico, per mese: la parte dell'anno indicata da "stima")
  elenco.forEach((p, i) => {
    const riepilogo = state.riepiloghi.get(p.anno);
    if (!riepilogo || !(p.mese === null ? !entrate[i] && !uscite[i] : p.stima)) return;
    const [prima, dopo] = p.mese === null ? [0, 1] : p.stima;
    const parte = (totale) => round2((totale ?? 0) * dopo) - round2((totale ?? 0) * prima);
    entrate[i] = parte(riepilogo.entrate);
    uscite[i] = parte(riepilogo.uscite);
    ultimo = Math.max(ultimo, i);
  });
  const risparmio = entrate.map((valore, i) => round2(valore - uscite[i]));

  // Il saldo riparte dal "saldo a inizio anno" di ogni anno che lo ha impostato
  let saldo = null;
  const saldi = elenco.map((p, i) => {
    const inizioAnno = p.mese === null || p.mese === 1 || i === 0;
    if (inizioAnno && state.saldi.has(p.anno)) saldo = state.saldi.get(p.anno);
    if (saldo === null || i > ultimo) return null;
    saldo = round2(saldo + risparmio[i]);
    return saldo;
  });
  return { entrate: entrate.map(round2), uscite: uscite.map(round2), risparmio, saldi };
}

// Periodi della tabella e del grafico andamento: con tutti gli anni anche gli anni del
// foglio "Pre 2023" senza movimenti. Nel grafico diventano i mesi lavorati (gli ultimi
// dell'anno), con la media mensile; "stima" = [parte dell'anno prima del mese, fino a fine
// mese]: con 8,3 mesi aprile vale 0,3 mesi, e la somma dei mesi torna con il totale.
function periodiAndamento(perGrafico) {
  const elenco = periodi(perGrafico);
  if (!tuttiGliAnni()) return elenco;
  const anni = new Set(elenco.map((p) => p.anno));
  for (const [anno, riepilogo] of state.riepiloghi) {
    if (anni.has(anno)) continue;
    if (!perGrafico) {
      elenco.push({ key: String(anno), label: String(anno), anno, mese: null });
      continue;
    }
    const mesi = Math.min(12, riepilogo.mesi ?? 12);
    const primo = 12 - Math.ceil(mesi) + 1;
    for (let mese = primo; mese <= 12; mese += 1) {
      const parte = (fine) => Math.max(0, mesi - (12 - fine)) / mesi;
      elenco.push({ key: `${anno}-${mese}`, label: `${MESI[mese - 1]} ${anno}`, anno, mese, stima: [parte(mese - 1), parte(mese)] });
    }
  }
  return elenco.sort((a, b) => a.anno - b.anno || (a.mese ?? 0) - (b.mese ?? 0));
}

// Mesi lavorati per anno: dal riepilogo; altrimenti 12, o i mesi con movimenti per l'anno in corso
function mesiLavorati(anno) {
  const riepilogo = state.riepiloghi.get(anno);
  if (riepilogo?.mesi != null) return riepilogo.mesi;
  if (anno < new Date().getFullYear()) return 12;
  return new Set(state.aggregati.filter((r) => r.anno === anno).map((r) => r.mese)).size;
}

// Righe delle categorie di un gruppo (Entrate o Uscite) della tabella andamento
function righeCategorie(tipo, elenco, withBudget, aperto) {
  const rows = totalsByCategory(tipo, elenco);
  const conBudget = tipo === "uscita";
  const categorie = categorieDelTipo(tipo, true).filter((c) => rows.has(c.id));
  const lines = categorie.map((c) => ({ id: c.id, nome: c.nome, ...rows.get(c.id) }));
  if (rows.has("nessuna")) lines.push({ id: "nessuna", nome: "Senza categoria", ...rows.get("nessuna") });

  let budgetTotale = 0;
  const html = lines.map((line) => {
    const budget = line.id === "nessuna" ? null : budgetFor(line.id);
    if (conBudget && budget) budgetTotale += budget;
    const celle = line.valori.map((valore, i) => {
      const p = elenco[i];
      // Con tutti gli anni il confronto è con il budget annuale (12 mesi)
      const mensile = conBudget && line.id !== "nessuna" ? budgetFor(line.id, p.anno) : null;
      const limite = mensile === null ? null : p.mese === null ? mensile * 12 : mensile;
      const over = limite !== null && valore > limite;
      const link = valore ? `data-anno="${p.anno}" data-mese="${p.mese === null ? "" : p.mese - 1}" data-categoria="${line.id}"` : "";
      return `<td class="num ${over ? "over" : ""} ${valore ? "clickable" : ""}" ${link} ${over ? `title="Oltre il budget di ${formatEuro(valore - limite)}"` : ""}>${valore ? formatNumber(valore) : '<span class="zero">—</span>'}</td>`;
    }).join("");
    const totale = line.valori.reduce((s, v) => s + v, 0);
    // Budget modificabile solo per un singolo anno e solo per le uscite
    const budgetCell = !withBudget ? "" : !conBudget || line.id === "nessuna"
      ? "<td></td>"
      : `<td class="num"><input class="budget-input" data-categoria="${line.id}" type="text" inputmode="decimal" value="${budget === null ? "" : String(budget).replace(".", ",")}" aria-label="Budget mensile ${escapeHtml(line.nome)}"></td>`;
    return `
      <tr class="cat-row${aperto ? "" : " hidden"}" data-gruppo="${tipo}">
        <th class="clickable" data-anno="${state.year ?? ""}" data-mese="" data-categoria="${line.id}">${escapeHtml(line.nome)}</th>
        ${celle}
        ${cell(totale, "strong")}
        ${cell(mediaMesiAttivi(line.valori))}
        ${budgetCell}
        <td class="num">${line.operazioni || ""}</td>
      </tr>`;
  }).join("");
  return { html, budgetTotale, operazioni: lines.reduce((s, l) => s + l.operazioni, 0) };
}

// Una sola tabella: Entrate e Uscite (con le categorie apribili sotto), poi risparmio e saldo
function renderAndamento() {
  const elenco = periodiAndamento(false);
  const { entrate, uscite, risparmio, saldi } = andamento(elenco);
  const withBudget = !tuttiGliAnni();
  const media = tuttiGliAnni() ? "Media annua" : "Media mensile";
  const vuote = withBudget ? "<td></td><td></td>" : "<td></td>"; // colonne Budget e Op.
  const sum = (valori) => valori.reduce((total, v) => total + v, 0);
  const row = (label, valori, className = "", coda = vuote) => `
    <tr class="${className}">
      <th>${label}</th>
      ${valori.map((v) => cell(v, v < 0 ? "negative" : "")).join("")}
      ${cell(sum(valori), sum(valori) < 0 ? "negative" : "")}
      ${cell(mediaMesiAttivi(valori))}
      ${coda}
    </tr>`;
  const gruppo = (tipo, label, valori) => {
    const aperto = state.gruppiAperti.has(tipo);
    const righe = righeCategorie(tipo, elenco, withBudget, aperto);
    const toggle = `<button class="group-toggle" type="button" data-gruppo="${tipo}" aria-expanded="${aperto}">${label}</button>`;
    const budget = !withBudget ? "" : tipo === "uscita" ? cell(righe.budgetTotale) : "<td></td>";
    return row(toggle, valori, "group-row", `${budget}<td class="num">${righe.operazioni || ""}</td>`) + righe.html;
  };
  const nessunSaldo = saldi.every((v) => v === null);

  // Con tutti gli anni, come il foglio "Pre 2023": mesi lavorati e medie al mese
  let storico = "";
  if (tuttiGliAnni()) {
    const mesi = elenco.map((p) => mesiLavorati(p.anno));
    const totaleMesi = sum(mesi);
    const alMese = (label, valori) => `
      <tr>
        <th>${label}</th>
        ${valori.map((v, i) => cell(mesi[i] ? v / mesi[i] : 0)).join("")}
        ${cell(totaleMesi ? sum(valori) / totaleMesi : 0)}
        <td></td>${vuote}
      </tr>`;
    storico = `
      <tr>
        <th>Mesi lavorati</th>
        ${mesi.map((m) => `<td class="num">${m.toLocaleString("it-IT")}</td>`).join("")}
        <td class="num">${totaleMesi.toLocaleString("it-IT")}</td>
        <td></td>${vuote}
      </tr>
      ${alMese("Entrate al mese", entrate)}
      ${alMese("Uscite al mese", uscite)}`;
  }

  elements.andamentoTable.innerHTML = !elenco.length ? '<tbody><tr><td class="empty">Nessun dato.</td></tr></tbody>' : `
    ${periodHeader("", elenco, [tuttiGliAnni() ? "Totale" : "Totale anno", media, ...(withBudget ? ["Budget"] : []), "Op."])}
    <tbody>
      ${gruppo("entrata", "Entrate", entrate)}
      ${gruppo("uscita", "Uscite", uscite)}
      ${row("Risparmio", risparmio, "strong-row risparmio-row")}
      <tr>
        <th>Saldo a fine ${tuttiGliAnni() ? "anno" : "mese"}</th>
        ${saldi.map((v) => (v === null ? '<td class="num"><span class="zero">—</span></td>' : cell(v))).join("")}
        <td class="num" colspan="${withBudget ? 4 : 3}">${nessunSaldo ? '<span class="zero">saldo iniziale mancante: rilancia l’import</span>' : ""}</td>
      </tr>
      ${storico}
    </tbody>`;
  elements.andamentoHint.classList.toggle("hidden", !tuttiGliAnni() || !state.riepiloghi.size);
}

// Apre o chiude le categorie sotto Entrate o Uscite senza ridisegnare la tabella
function apriChiudiGruppo(button) {
  const tipo = button.dataset.gruppo;
  const aperto = !state.gruppiAperti.has(tipo);
  if (aperto) state.gruppiAperti.add(tipo);
  else state.gruppiAperti.delete(tipo);
  button.setAttribute("aria-expanded", String(aperto));
  elements.andamentoTable.querySelectorAll(`.cat-row[data-gruppo="${tipo}"]`)
    .forEach((riga) => riga.classList.toggle("hidden", !aperto));
}

function renderDashboard() {
  const tipo = state.tipoDashboard;
  elements.toggleButtons.forEach((button) => button.classList.toggle("active", button.dataset.tipo === tipo));
  elements.titoloGraficoLinee.textContent = {
    sintesi: "Uscite, entrate, risparmio e saldo mensili",
    uscita: "Uscite per categoria nel tempo",
    entrata: "Entrate per categoria nel tempo"
  }[tipo];
  elements.titoloGraficoCategorie.textContent = tipo === "uscita"
    ? "Categorie per spesa (interno) e per n° operazioni (esterno)"
    : "Totale per categoria";
  // La Sintesi non ha la torta delle categorie; le linee per categoria hanno una legenda lunga
  elements.tortaCategorie.classList.toggle("hidden", tipo === "sintesi");
  elements.chartAndamento.parentElement.classList.toggle("per-categoria", tipo !== "sintesi");
  const anno = budgetYear();
  elements.budgetHint.textContent = tuttiGliAnni()
    ? "Con tutti gli anni le celle rosse superano il budget annuale (12 mesi); il budget si modifica scegliendo un anno."
    : anno !== null && anno !== state.year
      ? `Budget mensili del ${anno} (non ci sono ancora budget per il ${state.year}: modificandone uno si copiano tutti nel ${state.year}).`
      : "Budget mensili: le celle rosse lo superano.";
  elements.saldoField.classList.toggle("hidden", tuttiGliAnni());
  const saldo = state.saldi.get(state.year);
  elements.saldoValore.textContent = saldo === undefined ? "—" : formatEuro(saldo);
  elements.titoloPeriodo.textContent = tuttiGliAnni() ? "Andamento annuale" : "Andamento mensile";
  renderAndamento();
  renderPatrimonio();
  renderQuestoMese();
  if (tipo === "sintesi") renderCharts();
  else renderCategorieCharts(tipo);
}

// Valore a oggi degli investimenti ancora aperti: a prezzo di mercato se c'è la quotazione,
// altrimenti (BTP, E2C, ...) il capitale ancora investito (acquisti meno rimborsi già avvenuti)
function valoreInvestimenti() {
  const oggi = todayISO();
  let totale = 0;
  for (const posizione of new Set(state.investimenti.map((r) => r.posizione))) {
    if (statoPosizione(posizione).stato === "chiusa") continue;
    const quotazione = state.quotazioni.get(posizione);
    if (quotazione?.valore != null && !quotazione.errore) {
      totale += quotazione.valore;
      continue;
    }
    const passate = state.investimenti.filter((r) => r.posizione === posizione && !r.domani && r.data <= oggi);
    const investito = passate.filter((r) => r.operazione === "Investimento").reduce((s, r) => s - r.importo, 0);
    const rimborsato = passate.filter((r) => r.operazione === "Rimborso").reduce((s, r) => s + r.importo, 0);
    totale += Math.max(0, investito - rimborsato);
  }
  return round2(totale);
}

// Patrimonio a oggi: conto Intesa + liquidità Fineco + investimenti aperti
function renderPatrimonio() {
  const parti = [];
  if (state.contoOggi !== null) parti.push(["conto Intesa", state.contoOggi]);
  if (state.fineco) parti.push(["liquidità Fineco", state.fineco.liquidita]);
  const investimenti = valoreInvestimenti();
  if (investimenti) parti.push(["investimenti", investimenti]);
  elements.patrimonio.classList.toggle("hidden", !parti.length);
  const totale = round2(parti.reduce((s, [, valore]) => s + valore, 0));
  elements.patrimonio.innerHTML = `Patrimonio oggi <strong>${formatEuro(totale)}</strong>
    <span class="patrimonio-parti">= ${parti.map(([nome, valore]) => `${nome} ${formatEuro(valore)}`).join(" + ")}</span>
    <span class="hint-breve" title="Investimenti aperti a prezzo di mercato (Aggiorna prezzi); BTP, E2C e quelli senza quotazione al capitale ancora investito">ⓘ</span>`;
}

// Questo mese: per ogni categoria di uscita, speso finora e budget mensile, dalla più "consumata".
// Barra rossa oltre il budget, gialla se si spende più in fretta del mese che passa.
function renderQuestoMese() {
  const adesso = new Date();
  const anno = adesso.getFullYear();
  const mese = adesso.getMonth() + 1;
  const giorniMese = new Date(anno, mese, 0).getDate();
  const ritmo = adesso.getDate() / giorniMese; // parte del mese già passata
  const spese = new Map(state.usciteMese.map((r) => [r.categoria_id ?? "nessuna", r.speso]));
  const righe = categorieDelTipo("uscita")
    .map((c) => ({ id: c.id, nome: c.nome, speso: round2(spese.get(c.id) || 0), budget: budgetFor(c.id, anno) }))
    .filter((r) => r.speso > 0 || r.budget);
  if (spese.has("nessuna")) righe.push({ id: "nessuna", nome: "Senza categoria", speso: round2(spese.get("nessuna")), budget: null });
  const quota = (r) => (r.budget ? r.speso / r.budget : r.speso > 0 ? Infinity : 0);
  righe.sort((a, b) => quota(b) - quota(a) || b.speso - a.speso);

  const speso = round2(righe.reduce((s, r) => s + r.speso, 0));
  const budget = round2(righe.reduce((s, r) => s + (r.budget || 0), 0));
  const nomeMese = adesso.toLocaleString("it-IT", { month: "long" });
  elements.questoMeseTitolo.innerHTML = `<strong>Questo mese</strong> (${nomeMese}, giorno ${adesso.getDate()} di ${giorniMese}):
    speso <strong>${formatEuro(speso)}</strong>${budget ? ` su ${formatEuro(budget)} di budget (${Math.round((speso / budget) * 100)}%)` : ""}`;
  elements.questoMeseLista.innerHTML = righe.map((r) => {
    const q = quota(r);
    const colore = !r.budget ? "senza" : q > 1 ? "oltre" : q > ritmo ? "veloce" : "ok";
    const larghezza = r.budget ? Math.min(100, Math.round(q * 100)) : 100;
    return `
      <div class="mese-riga clickable" data-anno="${anno}" data-mese="${mese - 1}" data-categoria="${r.id}" title="Vedi i movimenti">
        <span class="mese-nome">${escapeHtml(r.nome)}</span>
        <span class="mese-barra"><i class="${colore}" style="width:${larghezza}%"></i></span>
        <span class="mese-valori">${formatNumber(r.speso)}${r.budget ? ` / ${formatNumber(r.budget)}` : ' <span class="zero">senza budget</span>'}</span>
      </div>`;
  }).join("") || '<p class="hint">Nessuna spesa questo mese.</p>';
}

// ---------------------------------------------------------------------------
// Grafici (Chart.js), come quelli della dashboard Excel
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e",
  "#636363", "#997300", "#255e91", "#43682b", "#698ed0", "#f1975a", "#b7b7b7", "#ffcd33",
  "#7cafdd", "#8cc168", "#335aa1", "#d26012", "#848484", "#cc9a00", "#3a7cb8", "#5a8a39"
];

// Scrive la percentuale sulle fette abbastanza grandi (come le etichette dell'Excel)
const percentLabels = {
  id: "percentLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const total = dataset.data.reduce((sum, v) => sum + v, 0);
      chart.getDatasetMeta(datasetIndex).data.forEach((arc, index) => {
        const share = total ? dataset.data[index] / total : 0;
        if (share < 0.04) return;
        const { x, y } = arc.tooltipPosition();
        ctx.fillText(`${Math.round(share * 100)}%`, x, y);
      });
    });
    ctx.restore();
  }
};

// Linea verticale sulla data di oggi: options.plugins.lineaOggi.posizione è la posizione
// sull'asse x: per un asse a etichette il "numero di punto", anche con la virgola (3,5 = a metà
// tra il 4° e il 5°); per un asse numerico (grafico investimenti) il valore, cioè la data
const lineaOggi = {
  id: "lineaOggi",
  afterDatasetsDraw(chart, _args, options) {
    const posizione = options?.posizione;
    if (posizione === null || posizione === undefined) return;
    const scala = chart.scales.x;
    // Grafico ingrandito (zoom) su un tratto che non contiene oggi: niente linea. Per l'asse a
    // mesi c'è un mese di margine (oggi cade tra il punto del mese in corso e il successivo).
    if (posizione < scala.min || posizione > scala.max + (scala.type === "category" ? 1 : 0)) return;
    const primo = Math.floor(posizione);
    const x0 = scala.getPixelForValue(primo);
    const { top, bottom, left, right } = chart.chartArea;
    const x = Math.min(right, Math.max(left, x0 + (posizione - primo) * (scala.getPixelForValue(primo + 1) - x0 || 0)));
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = "#1f2a24";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.fillStyle = "#1f2a24";
    ctx.font = "bold 11px sans-serif";
    // Vicino ai bordi la scritta va verso l'interno, per non essere tagliata
    ctx.textAlign = x > right - 20 ? "right" : x < left + 20 ? "left" : "center";
    ctx.fillText("oggi", x, top - 4);
    ctx.restore();
  }
};

function drawChart(key, canvas, config) {
  if (!window.Chart) return;
  state.charts[key]?.destroy();
  state.charts[key] = new window.Chart(canvas, config);
}


// Sul telefono (schermo stretto) i grafici hanno meno etichette e più piccole
const schermoStretto = () => window.innerWidth < 720;

// Importi dell'asse in breve (12.500 -> "12,5k €"): occupano meno spazio
function formatEuroBreve(valore) {
  if (Math.abs(valore) < 1000) return `${valore.toLocaleString("it-IT")} €`;
  return `${(valore / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })}k €`;
}

// Voci della riga dei valori (fa da legenda), a tre clic sulla stessa voce: il 1° nasconde
// la linea, il 2° mostra solo lei, il 3° rimette tutto visibile. Su una voce nascosta
// (barrata), un clic la fa ricomparire.
function cicloLinee(chart, i) {
  const stessaVoce = chart.$legenda?.indice === i;
  if (!stessaVoce && !chart.isDatasetVisible(i)) {
    chart.setDatasetVisibility(i, true);
    chart.$legenda = null;
  } else {
    const passo = stessaVoce ? chart.$legenda.passo + 1 : 1;
    chart.data.datasets.forEach((_, j) => {
      if (passo === 1 && j === i) chart.setDatasetVisibility(j, false);
      if (passo === 2) chart.setDatasetVisibility(j, j === i);
      if (passo === 3) chart.setDatasetVisibility(j, true);
    });
    chart.$legenda = passo === 3 ? null : { indice: i, passo };
  }
  chart.update();
  // la riga dei valori sotto il grafico segue le linee visibili
  if (chart.$titoloValori) mostraValori(chart, chart.$indiceValori);
}

// Riga dei valori sotto il grafico, al posto della legenda e del riquadro scuro di Chart.js
// (che con tante linee copriva tutto): passando il mouse (o il dito) sul grafico mostra la
// data e i valori di quel punto, con il colore di ogni linea; le linee nascoste restano
// barrate per poterle rimettere. chart.$titoloValori(i) dà la data del punto i.
const valoreY = (punto) => (punto !== null && typeof punto === "object" ? punto.y : punto);

function mostraValori(chart, indice) {
  let riga = chart.canvas.parentElement.nextElementSibling;
  if (!riga?.classList.contains("valori-grafico")) {
    riga = document.createElement("p");
    riga.className = "valori-grafico";
    chart.canvas.parentElement.after(riga);
    // clic su una voce: nascondi / solo questa / tutte (vedi cicloLinee)
    riga.addEventListener("click", (event) => {
      const voce = event.target.closest(".valore[data-indice]");
      if (voce) cicloLinee(riga.$chart, Number(voce.dataset.indice));
    });
  }
  riga.$chart = chart;
  chart.$indiceValori = indice;
  if (indice === null || indice < 0) {
    riga.textContent = "";
    return;
  }
  const voci = chart.data.datasets
    .map((dataset, i) => ({ dataset, i, visibile: chart.isDatasetVisible(i), valore: valoreY(dataset.data[indice]) }))
    .filter((v) => !v.visibile || (v.valore !== null && v.valore !== undefined && v.valore !== 0));
  // Con tante linee (categorie) dal valore più grande; altrimenti nell'ordine delle linee.
  // Le nascoste in fondo.
  const peso = (v) => (v.visibile ? Math.abs(v.valore) : -1);
  if (chart.data.datasets.length > 5) voci.sort((a, b) => peso(b) - peso(a));
  else voci.sort((a, b) => b.visibile - a.visibile);
  riga.innerHTML = `<strong>${escapeHtml(chart.$titoloValori(indice))}</strong>${
    voci.length
      ? voci.map(({ dataset, i, visibile, valore }) => `<span class="valore ${visibile ? "" : "nascosta"}" data-indice="${i}" title="Clic: nascondi · di nuovo: solo questa · di nuovo: tutte"><i style="background:${dataset.borderColor}"></i>${escapeHtml(dataset.label)}${visibile ? ` <b>${formatEuro(valore)}</b>` : ""}</span>`).join("")
      : '<span class="zero">nessun valore</span>'
  }`;
}

// Opzione tooltip dei grafici a linee: niente riquadro, aggiorna la riga dei valori
// (sul telefono la riga si vede solo con il grafico in primo piano)
const valoriSottoIlGrafico = {
  enabled: false,
  external: ({ chart, tooltip }) => {
    const indice = tooltip.dataPoints?.[0]?.dataIndex;
    if (indice !== undefined && tooltip.opacity !== 0 && indice !== chart.$indiceValori) mostraValori(chart, indice);
  }
};

// Telefono: toccando un grafico a linee lo si porta in primo piano (a schermo intero), con
// sotto i valori del mese toccato da copiare. Si chiude con ✕ o con il tasto indietro.
function apriPrimoPiano(box) {
  if (!schermoStretto() || box.classList.contains("primo-piano")) return;
  box.classList.add("primo-piano");
  document.body.classList.add("con-primo-piano");
  history.pushState({ primoPiano: true }, "");
  ridisegnaGrafico(box); // con lo zoom a due dita acceso
}

function chiudiPrimoPiano() {
  document.querySelectorAll(".chart-box.primo-piano").forEach((box) => {
    box.classList.remove("primo-piano");
    ridisegnaGrafico(box); // zoom spento: il dito sul grafico torna a far scorrere la pagina
  });
  document.body.classList.remove("con-primo-piano");
}

// Ridisegna il grafico a linee di un riquadro tenendo il punto mostrato nella riga dei valori
function ridisegnaGrafico(box) {
  const canvas = box.querySelector("canvas");
  const indice = window.Chart?.getChart(canvas)?.$indiceValori;
  if (canvas === elements.chartAndamento) {
    if (state.tipoDashboard === "sintesi") renderCharts();
    else renderCategorieCharts(state.tipoDashboard);
  }
  if (canvas === elements.chartInvestimenti) renderInvestimenti();
  const chart = window.Chart?.getChart(canvas);
  if (chart?.$titoloValori && indice !== undefined) mostraValori(chart, indice);
}

// Zoom nei grafici a linee (chartjs-plugin-zoom), solo in orizzontale: sul computer si
// trascina col mouse su un tratto; sul telefono a due dita, solo con il grafico in primo
// piano (altrimenti il dito sul grafico non farebbe più scorrere la pagina).
// "Reimposta zoom" o doppio clic per tornare al grafico intero. ampiezzaMinima nelle unità
// dell'asse x (mesi per la Dashboard, millisecondi per gli investimenti).
function opzioniZoom(canvas, ampiezzaMinima) {
  const telefono = schermoStretto();
  const attivo = !telefono || canvas.closest(".chart-box").classList.contains("primo-piano");
  const mostraReset = ({ chart }) => {
    chart.canvas.parentElement.querySelector(".zoom-reset").classList.toggle("hidden", !chart.isZoomedOrPanned());
  };
  canvas.parentElement.querySelector(".zoom-reset").classList.add("hidden"); // grafico nuovo: non ingrandito
  return {
    zoom: {
      drag: { enabled: attivo && !telefono, backgroundColor: "rgba(63, 109, 86, 0.15)" },
      pinch: { enabled: attivo && telefono },
      mode: "x",
      onZoomComplete: mostraReset
    },
    pan: { enabled: attivo && telefono, mode: "x", onPanComplete: mostraReset },
    limits: { x: { min: "original", max: "original", minRange: ampiezzaMinima } }
  };
}

function reimpostaZoom(canvas) {
  window.Chart?.getChart(canvas)?.resetZoom();
  canvas.parentElement.querySelector(".zoom-reset").classList.add("hidden");
}

// Dopo aver disegnato un grafico a linee: titolo dei punti e valori iniziali (l'ultimo punto
// fino a "fino", tornando indietro finché c'è almeno un valore)
function iniziaValori(key, titolo, fino) {
  const chart = state.charts[key];
  if (!chart) return;
  chart.$titoloValori = titolo;
  let indice = Math.min(fino ?? Infinity, Math.max(...chart.data.datasets.map((d) => d.data.length)) - 1);
  while (indice > 0 && !chart.data.datasets.some((d) => ![null, undefined, 0].includes(valoreY(d.data[indice])))) indice -= 1;
  mostraValori(chart, indice);
}

// Linea verticale sottile sul punto indicato dal mouse
const lineaCursore = {
  id: "lineaCursore",
  afterDatasetsDraw(chart) {
    const attivo = chart.getActiveElements()[0];
    if (!attivo) return;
    const { top, bottom } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = "rgba(31, 42, 36, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(attivo.element.x, top);
    ctx.lineTo(attivo.element.x, bottom);
    ctx.stroke();
    ctx.restore();
  }
};

// Grafici a linee senza legenda: ne fa le veci la riga dei valori sotto il grafico
const senzaLegenda = () => ({ display: false });

// Asse dei mesi: con un anno tutti i 12 mesi (etichetta e riga della griglia);
// con tutti gli anni i mesi sono troppi e se ne vede solo una parte
const asseMesi = () => ({
  ticks: tuttiGliAnni()
    ? { maxRotation: 0, autoSkip: true, maxTicksLimit: schermoStretto() ? 4 : 12 }
    : { maxRotation: 0, autoSkip: false, font: { size: schermoStretto() ? 10 : 12 } }
});

// Asse in euro; la riga dello 0 è più marcata per vedere subito quando si va sotto
const euroAxis = {
  y: {
    ticks: { callback: (value) => formatEuroBreve(value) },
    grid: {
      color: (ctx) => (ctx.tick?.value === 0 ? "rgba(31, 42, 36, 0.55)" : "rgba(0, 0, 0, 0.1)"),
      lineWidth: (ctx) => (ctx.tick?.value === 0 ? 2 : 1)
    }
  }
};

function percentTooltip(formatValue) {
  return {
    callbacks: {
      label: (item) => {
        const total = item.dataset.data.reduce((sum, v) => sum + v, 0);
        return `${item.label}: ${formatValue(item)} (${Math.round((item.raw / total) * 100)}%)`;
      }
    }
  };
}

// Totali dell'intero periodo scelto per ogni categoria di un tipo
function totaliCategorie(tipo) {
  const elenco = periodi(false);
  return [...totalsByCategory(tipo, elenco).entries()]
    .map(([id, riga]) => ({
      id,
      nome: id === "nessuna" ? "Senza categoria" : categoriaById(id)?.nome || "?",
      totale: round2(riga.valori.reduce((sum, v) => sum + v, 0)),
      valori: riga.valori,
      operazioni: riga.operazioni
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

// Posizione di oggi nel grafico mese per mese (null se il mese corrente non c'è): sul punto
// del mese in corso il primo del mese, poi avanza verso il mese dopo con il passare dei giorni
function posizioneOggiMesi(elenco) {
  const oggi = new Date();
  const i = elenco.findIndex((p) => p.anno === oggi.getFullYear() && p.mese === oggi.getMonth() + 1);
  if (i < 0) return null;
  const giorniMese = new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0).getDate();
  return i + (oggi.getDate() - 1) / giorniMese;
}

// Mesi dopo quello in corso: nei grafici a linee restano senza punto
function soloFinoAOggi(elenco, valori) {
  const oggi = new Date();
  const corrente = oggi.getFullYear() * 12 + oggi.getMonth() + 1;
  return valori.map((v, i) => {
    const p = elenco[i];
    return p.mese !== null && p.anno * 12 + p.mese > corrente ? null : v;
  });
}

function renderCharts() {
  const elenco = periodiAndamento(true);
  const { entrate, uscite, risparmio, saldi } = andamento(elenco);
  drawChart("andamento", elements.chartAndamento, {
    type: "line",
    data: {
      labels: elenco.map((p) => p.label),
      datasets: [
        { label: "Totale Uscite", data: soloFinoAOggi(elenco, uscite), borderColor: "#c0392b", backgroundColor: "#c0392b" },
        { label: "Totale Entrate", data: soloFinoAOggi(elenco, entrate), borderColor: "#2e8b57", backgroundColor: "#2e8b57" },
        { label: "Risparmio", data: soloFinoAOggi(elenco, risparmio), borderColor: "#2f6fbf", backgroundColor: "#2f6fbf" },
        { label: "Saldo a fine mese", data: soloFinoAOggi(elenco, saldi), borderColor: "#8a8a8a", backgroundColor: "#8a8a8a" }
      ]
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: tuttiGliAnni() ? 0 : 3 } },
      // Mesi del foglio "Pre 2023" (medie mensili): linea tratteggiata
      datasets: { line: { segment: { borderDash: (ctx) => (elenco[ctx.p1DataIndex]?.stima ? [5, 4] : undefined) } } },
      plugins: {
        legend: senzaLegenda(),
        zoom: opzioniZoom(elements.chartAndamento, 2), // almeno due mesi
        lineaOggi: { posizione: posizioneOggiMesi(elenco) },
        tooltip: valoriSottoIlGrafico
      },
      scales: { ...euroAxis, x: asseMesi() },
      layout: { padding: { top: 14 } }
    },
    plugins: [lineaOggi, lineaCursore]
  });
  iniziaValori("andamento", (i) => `${titoloMese(elenco[i])}${elenco[i].stima ? " (media mensile dal foglio Pre 2023)" : ""}`, Math.floor(posizioneOggiMesi(elenco) ?? Infinity));
}

// Mese e anno nella riga dei valori (con un solo anno l'etichetta sull'asse è solo il mese)
function titoloMese(periodo) {
  return `${MESI[periodo.mese - 1]} ${periodo.anno}`;
}

// Uscite o Entrate: una linea per categoria nel tempo e la torta del totale per categoria
// (per le uscite anche il n° di operazioni, nell'anello esterno)
function renderCategorieCharts(tipo) {
  const categorie = totaliCategorie(tipo);
  const colori = categorie.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  const legendaTorta = { position: window.innerWidth < 720 ? "bottom" : "right", labels: { boxWidth: 12, font: { size: 11 } } };
  if (tipo === "uscita") {
    drawChart("categorie", elements.chartCategorie, {
      type: "doughnut",
      data: {
        labels: categorie.map((c) => c.nome),
        datasets: [
          { label: "N° operazioni", data: categorie.map((c) => c.operazioni), backgroundColor: colori },
          { label: "Spesa", data: categorie.map((c) => Math.max(0, c.totale)), backgroundColor: colori }
        ]
      },
      options: {
        maintainAspectRatio: false,
        cutout: "35%",
        plugins: {
          legend: legendaTorta,
          tooltip: percentTooltip((item) => (item.dataset.label === "Spesa" ? formatEuro(item.raw) : `${item.raw} operazioni`))
        }
      },
      plugins: [percentLabels]
    });
  } else {
    drawChart("categorie", elements.chartCategorie, {
      type: "pie",
      data: {
        labels: categorie.map((c) => c.nome),
        datasets: [{ label: "Totale", data: categorie.map((c) => Math.max(0, c.totale)), backgroundColor: colori }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: legendaTorta, tooltip: percentTooltip((item) => formatEuro(item.raw)) }
      },
      plugins: [percentLabels]
    });
  }

  const elenco = periodi(true);
  const perCategoria = totalsByCategory(tipo, elenco);
  drawChart("andamento", elements.chartAndamento, {
    type: "line",
    data: {
      labels: elenco.map((p) => p.label),
      datasets: categorie.map((c, i) => ({
        label: c.nome,
        data: soloFinoAOggi(elenco, perCategoria.get(c.id)?.valori || []),
        borderColor: colori[i],
        backgroundColor: colori[i]
      }))
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: tuttiGliAnni() ? 0 : 3 } },
      plugins: { legend: senzaLegenda(), zoom: opzioniZoom(elements.chartAndamento, 2), tooltip: valoriSottoIlGrafico, lineaOggi: { posizione: posizioneOggiMesi(elenco) } },
      scales: { ...euroAxis, x: asseMesi() },
      layout: { padding: { top: 14 } }
    },
    plugins: [lineaOggi, lineaCursore]
  });
  iniziaValori("andamento", (i) => titoloMese(elenco[i]), Math.floor(posizioneOggiMesi(elenco) ?? Infinity));
}

async function saveBudget(input) {
  const categoriaId = Number(input.dataset.categoria);
  const text = input.value.trim();
  // Primo budget dell'anno: parte da una copia di quelli dell'anno precedente
  const annoEreditato = budgetYear();
  if (annoEreditato !== null && annoEreditato !== state.year) {
    const copie = state.budget
      .filter((riga) => riga.anno === annoEreditato)
      .map((riga) => ({ categoria_id: riga.categoria_id, anno: state.year, importo_mensile: riga.importo_mensile }));
    const { error } = await state.supabase.from("budget").upsert(copie, { onConflict: "categoria_id,anno" });
    if (error) return showFeedback(`Budget non salvato: ${error.message}`, "error");
  }
  if (!text) {
    const { error } = await state.supabase.from("budget").delete().eq("categoria_id", categoriaId).eq("anno", state.year);
    if (error) return showFeedback(`Budget non salvato: ${error.message}`, "error");
  } else {
    const importo = parseAmount(text);
    if (importo === null || importo < 0) return showFeedback("Budget non valido.", "error");
    const { error } = await state.supabase
      .from("budget")
      .upsert({ categoria_id: categoriaId, anno: state.year, importo_mensile: importo }, { onConflict: "categoria_id,anno" });
    if (error) return showFeedback(`Budget non salvato: ${error.message}`, "error");
  }
  showFeedback(`Budget ${state.year} salvato.`);
  await reload();
}

// ---------------------------------------------------------------------------
// Estratto conto Fineco ("+ Excel Fineco" in Posizioni)
// Tutte le righe del file vanno in movimenti_fineco (senza doppioni): la loro somma è la
// liquidità sul conto. Da compravendite, cedole e dividendi il sito propone le operazioni
// del registro che mancano, collegate alla posizione dal nome Fineco del titolo
// (tabella mappatura_titoli, scelto nell'anteprima e poi ricordato).
// ---------------------------------------------------------------------------

function tipoFineco(descrizione) {
  const d = descrizione.toLowerCase();
  if (d.startsWith("compravendita")) return "Titoli";
  if (/cedol|dividend|div\./.test(d)) return "Cedole e dividendi";
  if (d.includes("portaf")) return "Interessi"; // interessi sulla liquidità e la loro ritenuta
  if (d.startsWith("bonifico")) return "Bonifici";
  if (/imposta|bollo|tobin|commission/.test(d)) return "Costi";
  return "Altro";
}

function chiaveFineco(riga) {
  return `${riga.data}|${Number(riga.importo).toFixed(2)}|${normalize(riga.descrizione_completa)}`;
}

// Intestazione "Data_Operazione | Data_Valuta | Entrate | Uscite | Descrizione |
// Descrizione_Completa | Stato": si tengono solo i movimenti contabilizzati
function leggiFineco(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const righe = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const inizio = righe.findIndex((r) => String(r[0] ?? "").trim() === "Data_Operazione");
  if (inizio === -1) return null;
  const testo = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const numero = (v) => (typeof v === "number" ? v : parseAmount(v) || 0);
  const saldo = righe.slice(0, inizio).map((r) => testo(r[0])).find((t) => t.startsWith("Saldo Finale"));
  const movimenti = righe.slice(inizio + 1).map((r) => {
    const data = excelDate(r[0]);
    const importo = round2(numero(r[2]) + numero(r[3]));
    if (!data || !importo || (r[6] && testo(r[6]) !== "Contabilizzato")) return null;
    const descrizione = testo(r[4]);
    return { data, data_valuta: excelDate(r[1]), importo, descrizione, descrizione_completa: testo(r[5]), tipo: tipoFineco(descrizione) };
  }).filter(Boolean);
  return { movimenti, saldoFinale: saldo ? parseAmount(saldo.split(":")[1]) : null };
}

// Nome del titolo (e quantità per le compravendite) dalla descrizione completa
function titoloFineco(movimento) {
  const c = movimento.descrizione_completa;
  const compravendita = c.match(/Compravendita Titoli (.+?) Qta\/Val\.nom\.\s*([\d.,]+)/i);
  if (compravendita) {
    const nome = compravendita[1].trim();
    const valore = parseAmount(compravendita[2]);
    // Per i BTP Fineco dà il valore nominale: nel registro la quantità è in titoli da 1000 €
    return { nome, quantita: /^BTP/i.test(nome) ? valore / 1000 : valore };
  }
  const nome = c
    .replace(/^(Rit\.ced\.su|Ced\.su|Rit\.div\.su|Div\.su|Acc\.div\.Port\.Rem\.|Add\.rit\.Port\.Rem\.)\s*/i, "")
    .replace(/^[\d.,]+\s+/, "")
    .trim();
  return { nome, quantita: null };
}

// Operazioni del file: acquisti, vendite, cedole e dividendi al netto della ritenuta dello
// stesso giorno sullo stesso titolo (lordo tenuto a parte per il confronto con il registro)
function operazioniFineco(movimenti) {
  const operazioni = [];
  const cedole = new Map();
  for (const m of movimenti) {
    const { nome, quantita } = titoloFineco(m);
    if (m.tipo === "Titoli") {
      operazioni.push({ tipo: m.importo < 0 ? "acquisto" : "vendita", data: m.data, nome, quantita, importo: m.importo, righe: [m] });
    } else if (m.tipo === "Cedole e dividendi") {
      const chiave = `${m.data}|${nome.replace(/\s+/g, "").toUpperCase()}`;
      const op = cedole.get(chiave) || { tipo: "cedola", data: m.data, nome, quantita: null, importo: 0, lordo: 0, dividendo: false, righe: [] };
      op.importo = round2(op.importo + m.importo);
      if (m.importo > 0) {
        op.lordo = round2(op.lordo + m.importo);
        op.nome = nome; // il nome giusto è quello della riga lorda (le ritenute a volte lo spezzano)
      }
      if (/div/i.test(m.descrizione)) op.dividendo = true;
      op.righe.push(m);
      cedole.set(chiave, op);
    }
  }
  return [...operazioni, ...[...cedole.values()].filter((op) => op.lordo > 0)].sort((a, b) => a.data.localeCompare(b.data));
}

// Operazione del registro corrispondente: stesso tipo, data entro 10 giorni (il registro usa
// spesso la data dell'ordine, Fineco quella di contabilizzazione) e stesso importo; per le
// cedole va bene anche il lordo; per le vendite rimborso + guadagno dello stesso giorno
function trovaNelRegistro(op, registro, usate) {
  const giorni = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
  const circa = (a, b, tolleranza = 0.02) => Math.abs(Math.abs(a) - Math.abs(b)) <= tolleranza;
  const vicine = registro.filter((r) => !usate.has(r.id) && giorni(r.data, op.data) <= 10);
  if (op.tipo === "acquisto") return { riga: vicine.find((r) => r.operazione === "Investimento" && circa(r.importo, op.importo)), altre: [] };
  if (op.tipo === "cedola") {
    return { riga: vicine.find((r) => ["Cedola", "Dividendi"].includes(r.operazione) && (circa(r.importo, op.importo) || circa(r.importo, op.lordo))), altre: [] };
  }
  for (const r of vicine.filter((v) => v.operazione === "Rimborso")) {
    const guadagni = registro.filter((g) => g.posizione === r.posizione && g.data === r.data && g.operazione === "Cedola" && !usate.has(g.id));
    const totale = r.importo + guadagni.reduce((s, g) => s + g.importo, 0);
    const stesseQuote = r.quantita == null || op.quantita == null || circa(r.quantita, op.quantita, 0.001);
    if (Math.abs(totale - op.importo) <= 5 && stesseQuote) return { riga: r, altre: guadagni };
  }
  return { riga: null, altre: [] };
}

async function handleFinecoFile(file) {
  elements.finecoInput.value = "";
  if (!file) return;
  elements.finecoButton.disabled = true;
  try {
    await loadSheetJS();
    const letto = leggiFineco(window.XLSX.read(await file.arrayBuffer(), { type: "array" }));
    if (!letto?.movimenti.length) {
      showFeedback("Non sembra un estratto conto Fineco: manca la riga di intestazione \"Data_Operazione\".", "error");
      return;
    }
    const [esistenti, mappatura] = await Promise.all([
      fetchAll(() => state.supabase.from("movimenti_fineco").select("data,importo,descrizione_completa").order("id")),
      fetchAll(() => state.supabase.from("mappatura_titoli").select("*").order("id"))
    ]);
    // Movimenti nuovi: come per l'estratto Intesa, i doppioni veri si contano
    const presenti = new Map();
    for (const r of esistenti) presenti.set(chiaveFineco(r), (presenti.get(chiaveFineco(r)) || 0) + 1);
    const nuovi = letto.movimenti.filter((m) => {
      const chiave = chiaveFineco(m);
      if (!presenti.get(chiave)) return true;
      presenti.set(chiave, presenti.get(chiave) - 1);
      return false;
    });

    // Operazioni del file confrontate con il registro (tutte, anche quelle di movimenti già
    // importati, così le righe del registro che corrispondono non risultano "non trovate")
    const registro = state.investimenti.filter((r) => !r.domani);
    const usate = new Set();
    const posizioni = new Map(mappatura.map((r) => [r.nome_fineco, r.posizione]));
    const periodi = new Map(); // nome Fineco -> Map(posizione -> { dal, al }) dalle operazioni trovate
    const nuoviSet = new Set(nuovi);
    const operazioni = operazioniFineco(letto.movimenti);
    for (const op of operazioni) {
      const { riga, altre } = trovaNelRegistro(op, registro, usate);
      op.nuova = op.righe.some((m) => nuoviSet.has(m));
      if (!riga) continue;
      op.trovata = riga;
      [riga, ...altre].forEach((r) => usate.add(r.id));
      // la posizione di un titolo si impara dalle operazioni già registrate (vince la più recente)
      if (!mappatura.some((m) => m.nome_fineco === op.nome)) posizioni.set(op.nome, riga.posizione);
      if (!periodi.has(op.nome)) periodi.set(op.nome, new Map());
      const periodo = periodi.get(op.nome).get(riga.posizione) || { dal: op.data, al: op.data };
      periodi.get(op.nome).set(riga.posizione, { dal: periodo.dal < op.data ? periodo.dal : op.data, al: periodo.al > op.data ? periodo.al : op.data });
    }
    const date = letto.movimenti.map((m) => m.data).sort();
    state.importFineco = {
      nomeFile: file.name, movimenti: letto.movimenti, nuovi, saldoFinale: letto.saldoFinale,
      dal: date[0], al: date[date.length - 1], operazioni, posizioni, periodi, usate,
      scelte: new Map(), // nome Fineco -> posizione scelta nell'anteprima (numero o "nuova")
      escluse: new Set(), // operazioni proposte non spuntate
      tenute: new Set() // righe del registro "non trovate" da non eliminare
    };
    renderFinecoPanel();
  } catch (error) {
    console.error(error);
    showFeedback(`File non letto: ${error.message}`, "error");
  } finally {
    elements.finecoButton.disabled = false;
  }
}

function posizioneScelta(imp, nome) {
  return imp.scelte.has(nome) ? imp.scelte.get(nome) : imp.posizioni.get(nome);
}

// Stesso titolo in più posizioni (es. NVIDIA comprata, venduta e ricomprata): vale quella
// attiva in quella data, con 30 giorni di margine dopo l'ultima operazione per i dividendi
function posizionePerData(imp, nome, data) {
  const periodi = imp.periodi.get(nome);
  if (!data || imp.scelte.has(nome) || !periodi || periodi.size < 2) return undefined;
  const conMargine = (iso) => new Date(new Date(iso).getTime() + 30 * 86400000).toISOString().slice(0, 10);
  return [...periodi.entries()].find(([, p]) => data >= p.dal && data <= conMargine(p.al))?.[0];
}

// Posizione numerica di un titolo: le "nuove" prendono i numeri dopo l'ultimo usato
function posizioneEffettiva(imp, nome, data = null) {
  const scelta = posizionePerData(imp, nome, data) ?? posizioneScelta(imp, nome);
  if (scelta !== "nuova") return scelta;
  const nuove = [...new Set(imp.operazioni.map((o) => o.nome))].filter((n) => posizioneScelta(imp, n) === "nuova");
  return Math.max(-1, ...state.investimenti.map((r) => r.posizione)) + 1 + nuove.indexOf(nome);
}

function nomePosizione(posizione) {
  return state.investimenti.find((r) => r.posizione === posizione)?.nome || null;
}

// Righe del registro (acquisti) delle posizioni Fineco, nel periodo del file, senza
// corrispondenza su Fineco: di solito righe aggregate (es. più acquisti in una riga)
function righeNonTrovate(imp) {
  const posizioniFineco = new Set(imp.operazioni.map((o) => posizioneEffettiva(imp, o.nome, o.data)).filter((p) => p !== undefined));
  return state.investimenti.filter((r) => !r.domani && r.operazione === "Investimento" && posizioniFineco.has(r.posizione)
    && r.data >= imp.dal && r.data <= imp.al && !imp.usate.has(r.id));
}

// Prezzo medio di carico prima di una vendita: l'ABP del conto se registrato, altrimenti
// il costo medio degli acquisti (registro e questo import)
function prezzoCarico(imp, posizione, data, eliminate) {
  const conAbp = state.investimenti.filter((r) => r.posizione === posizione && r.abp > 0 && r.data <= data).sort((a, b) => a.data.localeCompare(b.data));
  if (conAbp.length) return conAbp[conAbp.length - 1].abp;
  const acquisti = [
    ...state.investimenti.filter((r) => !r.domani && r.posizione === posizione && r.operazione === "Investimento" && r.data < data && !eliminate.has(r.id)),
    ...imp.proposte.filter((o) => o.tipo === "acquisto" && o.data < data && posizioneEffettiva(imp, o.nome, o.data) === posizione)
  ];
  const quote = acquisti.reduce((s, a) => s + (a.quantita || 0), 0);
  return quote ? acquisti.reduce((s, a) => s - a.importo, 0) / quote : null;
}

// Righe da inserire nel registro per un'operazione proposta
function righeRegistro(imp, op, eliminate = new Set()) {
  const posizione = posizioneEffettiva(imp, op.nome, op.data);
  const modello = state.investimenti.find((r) => r.posizione === posizione) || {};
  const base = {
    posizione, data: op.data, nome: modello.nome || op.nome, isin: modello.isin ?? null,
    prodotto: modello.prodotto ?? null, tipo: modello.tipo ?? null,
    note: `Fineco: ${op.righe[0].descrizione_completa}`.slice(0, 200)
  };
  if (op.tipo === "acquisto") return [{ ...base, operazione: "Investimento", quantita: op.quantita, importo: op.importo }];
  if (op.tipo === "cedola") return [{ ...base, operazione: op.dividendo ? "Dividendi" : "Cedola", quantita: null, importo: op.importo }];
  // Vendita: come nel registro, rimborso al prezzo di carico + guadagno (o perdita) come cedola
  const carico = prezzoCarico(imp, posizione, op.data, eliminate);
  const rimborso = carico && op.quantita ? round2(carico * op.quantita) : op.importo;
  const righe = [{ ...base, operazione: "Rimborso", quantita: op.quantita, importo: rimborso }];
  if (round2(op.importo - rimborso)) righe.push({ ...base, operazione: "Cedola", quantita: op.quantita, importo: round2(op.importo - rimborso) });
  return righe;
}

function renderFinecoPanel() {
  const imp = state.importFineco;
  if (!imp) {
    elements.finecoPanel.classList.add("hidden");
    return;
  }
  imp.proposte = imp.operazioni.filter((op) => !op.trovata && op.nuova);
  const giaPresenti = imp.operazioni.filter((op) => op.trovata);
  const nonTrovate = righeNonTrovate(imp);
  const eliminate = new Set(nonTrovate.filter((r) => !imp.tenute.has(r.id)).map((r) => r.id));
  const nomi = [...new Set(imp.proposte.map((op) => op.nome))];
  const daFare = imp.nuovi.length || imp.proposte.length || nonTrovate.length;

  // Movimenti nuovi del conto per tipo, e saldo dopo l'import confrontato con quello di Fineco
  const perTipo = new Map();
  for (const m of imp.nuovi) {
    const t = perTipo.get(m.tipo) || { n: 0, totale: 0 };
    t.n += 1;
    t.totale = round2(t.totale + m.importo);
    perTipo.set(m.tipo, t);
  }
  const saldoDopo = round2((state.fineco?.liquidita || 0) + imp.nuovi.reduce((s, m) => s + m.importo, 0));
  const saldoOk = imp.saldoFinale === null || Math.abs(saldoDopo - imp.saldoFinale) < 0.01;

  const posizioniNote = [...new Map(state.investimenti.map((r) => [r.posizione, r.nome])).entries()].sort((a, b) => a[0] - b[0]);
  const sceltaNome = (nome) => {
    const scelta = posizioneScelta(imp, nome);
    return `<select class="fineco-scelta" data-nome="${escapeHtml(nome)}" aria-label="Posizione per ${escapeHtml(nome)}">
      <option value="" ${scelta === undefined ? "selected" : ""}>— scegli —</option>
      ${posizioniNote.map(([p, n]) => `<option value="${p}" ${scelta === p ? "selected" : ""}>${p} · ${escapeHtml(n)}</option>`).join("")}
      <option value="nuova" ${scelta === "nuova" ? "selected" : ""}>Nuova posizione "${escapeHtml(nome)}"</option>
    </select>`;
  };
  const descrizioneOp = (op) => {
    const posizione = posizioneEffettiva(imp, op.nome, op.data);
    if (posizione === undefined) return '<em class="negative">posizione da scegliere</em>';
    return righeRegistro(imp, op, eliminate)
      .map((r) => `${r.operazione} ${formatNumber(r.importo)}`).join(" + ") + ` <span class="hint">(posizione ${posizione})</span>`;
  };

  elements.finecoPanel.innerHTML = `
    <h2>Estratto Fineco "${escapeHtml(imp.nomeFile)}"</h2>
    <p>${imp.movimenti.length} movimenti nel file (dal ${formatDate(imp.dal)} al ${formatDate(imp.al)}):
      <strong>${imp.nuovi.length} nuovi</strong>, ${imp.movimenti.length - imp.nuovi.length} già importati.
      ${[...perTipo.entries()].map(([tipo, t]) => `${tipo} ${t.n} (${formatEuro(t.totale)})`).join(" · ")}</p>
    <p>Liquidità sul conto dopo l'import: <strong>${formatEuro(saldoDopo)}</strong>
      ${imp.saldoFinale === null ? "" : saldoOk
        ? `<span class="positive">= saldo finale Fineco</span>`
        : `<span class="negative">diversa dal saldo finale Fineco (${formatEuro(imp.saldoFinale)}): manca qualche movimento più vecchio?</span>`}</p>

    ${nomi.length ? `
      <h2>Titoli → posizione del registro</h2>
      <p class="hint">Scegli una volta a quale posizione corrisponde ogni nome Fineco: viene ricordato.</p>
      <div class="table-wrap"><table class="summary-table">
        <tbody>${nomi.map((nome) => `<tr><th>${escapeHtml(nome)}</th><td>${sceltaNome(nome)}</td></tr>`).join("")}</tbody>
      </table></div>` : ""}

    <h2>Operazioni da aggiungere al registro (${imp.proposte.length})</h2>
    ${imp.proposte.length ? `
      <div class="table-wrap import-preview"><table class="summary-table">
        <thead><tr><th></th><th>Data</th><th>Titolo Fineco</th><th class="num">Quantità</th><th>Nel registro</th></tr></thead>
        <tbody>${imp.proposte.map((op, i) => `
          <tr>
            <td><input class="fineco-op" type="checkbox" data-indice="${i}" ${imp.escluse.has(i) ? "" : "checked"} aria-label="Importa"></td>
            <td>${formatDate(op.data)}</td>
            <td>${escapeHtml(op.nome)}</td>
            <td class="num">${op.quantita === null ? "" : formatQuantity(op.quantita)}</td>
            <td>${descrizioneOp(op)}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>` : '<p class="hint">Nessuna: il registro ha già tutte le operazioni del file.</p>'}

    ${nonTrovate.length ? `
      <h2>Nel registro ma non su Fineco (${nonTrovate.length})</h2>
      <p class="hint">Acquisti delle stesse posizioni, nel periodo del file, che Fineco non ha: di solito righe che
        riassumono più acquisti. Spuntate = vengono eliminate, al loro posto restano gli acquisti veri qui sopra.</p>
      <div class="table-wrap"><table class="summary-table">
        <tbody>${nonTrovate.map((r) => `
          <tr>
            <td><input class="fineco-elimina" type="checkbox" data-id="${r.id}" ${imp.tenute.has(r.id) ? "" : "checked"} aria-label="Elimina"></td>
            <td>${formatDate(r.data)}</td><td>${r.posizione} · ${escapeHtml(r.nome)}</td>
            <td class="num">${formatQuantity(r.quantita)}</td><td class="num negative">${formatNumber(r.importo)}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>` : ""}

    ${giaPresenti.length ? `
      <details>
        <summary>${giaPresenti.length} operazioni del file già nel registro (saltate)</summary>
        <div class="table-wrap import-preview"><table class="summary-table">
          <tbody>${giaPresenti.map((op) => `
            <tr><td>${formatDate(op.data)}</td><td>${escapeHtml(op.nome)}</td><td class="num">${formatNumber(op.importo)}</td>
              <td>→ ${formatDate(op.trovata.data)} ${op.trovata.operazione} ${formatNumber(op.trovata.importo)} (posizione ${op.trovata.posizione})</td></tr>`).join("")}
          </tbody>
        </table></div>
      </details>` : ""}

    <div class="box-actions">
      ${daFare ? '<button id="fineco-confirm" class="primary-button" type="button">Importa</button>' : ""}
      <button id="fineco-cancel" class="secondary-button" type="button">${daFare ? "Annulla" : "Chiudi"}</button>
    </div>`;
  elements.finecoPanel.classList.remove("hidden");
}

async function confermaFineco() {
  const imp = state.importFineco;
  const selezionate = imp.proposte.filter((_, i) => !imp.escluse.has(i));
  const senzaPosizione = [...new Set(selezionate.filter((op) => posizioneEffettiva(imp, op.nome, op.data) === undefined).map((op) => op.nome))];
  if (senzaPosizione.length) {
    showFeedback(`Scegli la posizione per: ${senzaPosizione.join(", ")}.`, "error");
    return;
  }
  const eliminate = new Set(righeNonTrovate(imp).filter((r) => !imp.tenute.has(r.id)).map((r) => r.id));
  const righe = selezionate.flatMap((op) => righeRegistro(imp, op, eliminate));
  const mappatura = [...new Set(imp.operazioni.map((o) => o.nome))]
    .map((nome) => ({ nome_fineco: nome, posizione: posizioneEffettiva(imp, nome) }))
    .filter((m) => m.posizione !== undefined);
  const bottone = document.querySelector("#fineco-confirm");
  bottone.disabled = true;
  bottone.textContent = "Importazione...";
  try {
    // Prima il registro, poi i movimenti del conto: se qualcosa va storto, reimportando lo
    // stesso file le operazioni già aggiunte risultano "già nel registro"
    if (eliminate.size) {
      const { error } = await state.supabase.from("investimenti").delete().in("id", [...eliminate]);
      if (error) throw error;
    }
    if (righe.length) {
      const { error } = await state.supabase.from("investimenti").insert(righe);
      if (error) throw error;
    }
    if (mappatura.length) {
      const { error } = await state.supabase.from("mappatura_titoli").upsert(mappatura, { onConflict: "nome_fineco" });
      if (error) throw error;
    }
    for (let i = 0; i < imp.nuovi.length; i += 500) {
      const { error } = await state.supabase.from("movimenti_fineco").insert(imp.nuovi.slice(i, i + 500));
      if (error) throw error;
    }
    showFeedback(`Fineco: ${imp.nuovi.length} movimenti del conto, ${righe.length} righe aggiunte al registro${eliminate.size ? `, ${eliminate.size} eliminate` : ""}.`);
    state.importFineco = null;
    renderFinecoPanel();
    await reload();
  } catch (error) {
    console.error(error);
    showFeedback(`Importazione non riuscita: ${error.message}`, "error");
    bottone.disabled = false;
    bottone.textContent = "Importa";
  }
}

// ---------------------------------------------------------------------------
// Investimenti (come il foglio "Investimenti Dashboard")
// ---------------------------------------------------------------------------

// YEARFRAC di Excel con base 30/360, usato per la durata delle posizioni
function yearFrac(dataA, dataB) {
  let [y1, m1, d1] = dataA.split("-").map(Number);
  let [y2, m2, d2] = dataB.split("-").map(Number);
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 >= 30) d2 = 30;
  return ((y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)) / 360;
}

function formatQuantity(value) {
  return value === null ? "" : value.toLocaleString("it-IT", { maximumFractionDigits: 4 });
}

function investimentiVisibili() {
  const oggi = todayISO();
  return state.investimenti.filter((riga) => elements.invFuture.checked || riga.data <= oggi);
}

// Stesse formule del foglio: impegnato, rimborsi, interessi, risultato, rendimento
function riepilogoPosizioni(righe) {
  const posizioni = new Map();
  for (const riga of righe) {
    if (!posizioni.has(riga.posizione)) {
      posizioni.set(riga.posizione, {
        posizione: riga.posizione, nome: riga.nome, tipo: riga.tipo || "",
        impegnato: 0, rimborsi: 0, interessi: 0, primaData: riga.data, ultimaData: riga.data
      });
    }
    const p = posizioni.get(riga.posizione);
    if (riga.operazione === "Investimento") p.impegnato += Math.abs(riga.importo);
    if (riga.operazione === "Rimborso") p.rimborsi += riga.importo;
    if (riga.operazione === "Cedola" || riga.operazione === "Dividendi") p.interessi += riga.importo;
    if (riga.data < p.primaData) p.primaData = riga.data;
    if (riga.data > p.ultimaData) p.ultimaData = riga.data;
  }
  return [...posizioni.values()]
    .map((p) => {
      const maturato = p.rimborsi + p.interessi;
      const risultato = maturato - p.impegnato;
      const rendimento = p.impegnato ? (risultato / p.impegnato) * 100 : 0;
      const durata = yearFrac(p.primaData, p.ultimaData);
      return { ...p, maturato, risultato, rendimento, durata, annuo: durata > 0 ? rendimento / durata : null };
    })
    .sort((a, b) => a.posizione - b.posizione);
}

// Stato di una posizione, ricavato dal registro (come fa la funzione dei prezzi):
// con la riga "domani" (valore attuale) è aperta anche se ha già avuto rimborsi parziali (E2C);
// altrimenti chiusa = rimborso già avvenuto, a scadenza = rimborso in calendario (BTP)
function statoPosizione(posizione) {
  const oggi = todayISO();
  const operazioni = state.investimenti.filter((r) => r.posizione === posizione);
  if (operazioni.some((r) => r.domani)) return { stato: "aperta", data: null, testo: "Aperta" };
  const rimborsi = operazioni
    .filter((r) => r.operazione === "Rimborso")
    .map((r) => r.data)
    .sort();
  const passati = rimborsi.filter((d) => d <= oggi);
  if (passati.length) return { stato: "chiusa", data: passati[passati.length - 1], testo: `Chiusa il ${formatDate(passati[passati.length - 1])}` };
  if (rimborsi.length) return { stato: "scadenza", data: rimborsi[rimborsi.length - 1], testo: `A scadenza ${formatDate(rimborsi[rimborsi.length - 1])}` };
  return { stato: "aperta", data: null, testo: "Aperta" };
}

function percent(value) {
  return value === null ? "" : `${value.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
}

// Quotazioni (Edge Function "aggiorna-quotazioni"): plusvalenza se si vendesse domani
const ALIQUOTA_PLUSVALENZE = 0.26;

function daControllare(posizione) {
  const q = state.quotazioni.get(posizione);
  return Boolean(q && (q.quote_stimate || q.errore));
}

function titoloQuotazione(posizione) {
  const q = state.quotazioni.get(posizione);
  if (!q) return "";
  const testo = q.errore
    ? `Prezzo non aggiornato: ${q.errore}`
    : `${q.simbolo}: ${formatEuro(q.prezzo)} al ${formatDate(q.data_prezzo)}${q.quote_stimate ? " – quote stimate dal prezzo del giorno d'acquisto: inserisci quantità e ABP nel registro" : ""}`;
  return `title="${escapeHtml(testo)}"`;
}

function tassaPlusvalenza(posizione) {
  const plusvalenza = state.quotazioni.get(posizione)?.plusvalenza;
  return plusvalenza > 0 ? plusvalenza * ALIQUOTA_PLUSVALENZE : 0;
}

function renderQuotazioniInfo() {
  const date = [...state.quotazioni.values()].map((q) => q.data_prezzo).filter(Boolean).sort();
  const gialle = [...state.quotazioni.keys()].filter(daControllare).length;
  elements.quotazioniInfo.textContent = !date.length ? "" : `Prezzi al ${formatDate(date[date.length - 1])}${gialle ? ` · in giallo ${gialle} da controllare` : ""}`;
}

// Posizioni aperte a prezzo di mercato: ABP e book value modificabili (copiati dal conto)
function renderMercato() {
  const nomi = new Map(state.investimenti.map((r) => [r.posizione, r.nome]));
  const righe = [...state.quotazioni.values()].sort((a, b) => a.posizione - b.posizione);
  const suggerito = (v, cifre) => (v === null ? "" : v.toLocaleString("it-IT", { maximumFractionDigits: cifre }));
  elements.mercatoTable.innerHTML = !righe.length ? '<tbody><tr><td class="empty">Nessuna quotazione: premi "Aggiorna prezzi".</td></tr></tbody>' : `
    <thead><tr>
      <th>Nome</th><th class="num">ID</th><th class="num">Prezzo</th><th class="num" title="Prezzo medio di carico">ABP</th>
      <th class="num">Diff. per quota</th><th class="num">Quote</th><th class="num" title="Controvalore di carico: quote × ABP">Book value</th>
      <th class="num">Valore</th><th class="num">Plusvalenza</th>
      <th class="num" title="Plusvalenza meno la tassa del ${ALIQUOTA_PLUSVALENZE * 100}% (se positiva)">Netto</th>
    </tr></thead>
    <tbody>${righe.map((q) => {
      // ABP usato: quello dell'operazione più recente o costo / quote degli acquisti registrati.
      // Il calcolato è esatto se gli acquisti sono tutti registrati e non ci sono state vendite
      // parziali; altrimenti è in grigio (meglio copiare quello del conto)
      const abp = abpPosizione(q.posizione) || (q.quote ? q.costo / q.quote : null);
      const dalConto = Boolean(abpPosizione(q.posizione));
      const incerto = !dalConto && (q.quote_stimate || haVenditeParziali(q.posizione));
      const origineAbp = dalConto ? "Dal conto (copiato nel registro)"
        : incerto ? "Stimato: quote stimate o vendite parziali, copia l'ABP dal conto nel registro"
          : "Calcolato dagli acquisti registrati: costo / quote";
      const diff = q.prezzo !== null && abp ? q.prezzo - abp : null;
      const netto = q.plusvalenza === null ? null : q.plusvalenza - tassaPlusvalenza(q.posizione);
      return `
      <tr class="${daControllare(q.posizione) ? "da-controllare" : ""}" ${titoloQuotazione(q.posizione)}>
        <th class="clickable" data-posizione="${q.posizione}">${escapeHtml(nomi.get(q.posizione) || q.isin)}</th>
        <td class="num">${q.posizione}</td>
        <td class="num">${q.prezzo === null ? "" : suggerito(q.prezzo, 4)}</td>
        <td class="num ${incerto ? "calcolato" : ""}" title="${origineAbp}">${abp === null ? "" : suggerito(abp, 4)}</td>
        <td class="num ${diff < 0 ? "negative" : "positive"}">${diff === null ? "" : suggerito(diff, 4)}</td>
        <td class="num">${q.quote === null ? "" : suggerito(q.quote, 4)}</td>
        ${cell(q.costo)}
        ${cell(q.valore)}
        ${cell(q.plusvalenza, q.plusvalenza < 0 ? "negative" : "positive")}
        ${cell(netto, netto < 0 ? "negative" : "positive")}
      </tr>`;
    }).join("")}</tbody>`;
  etichettaColonne(elements.mercatoTable);
}

// Posizione ancora aperta che ha già avuto un rimborso (vendita parziale), escluse le righe "domani"
function haVenditeParziali(posizione) {
  const oggi = todayISO();
  return state.investimenti.some((r) => r.posizione === posizione && !r.domani && r.operazione === "Rimborso" && r.data <= oggi);
}

// ABP della posizione: quello dell'operazione più recente che ce l'ha
function abpPosizione(posizione) {
  const conAbp = state.investimenti
    .filter((r) => r.posizione === posizione && r.abp > 0)
    .sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
  return conAbp.length ? conAbp[conAbp.length - 1].abp : null;
}

// Il motivo vero di un errore della Edge Function è nella sua risposta, non in error.message
async function motivoErroreFunzione(error) {
  try {
    const risposta = error.context;
    const corpo = await risposta.text();
    return `${risposta.status} ${(JSON.parse(corpo).errore || JSON.parse(corpo).message) ?? corpo}`;
  } catch {
    // Nessuna risposta leggibile (funzione non pubblicata o rete): resta il messaggio generico
    return error.message;
  }
}

async function aggiornaPrezzi() {
  const bottoni = (inCorso) => elements.aggiornaPrezzi.forEach((b) => {
    b.disabled = inCorso;
    b.textContent = inCorso ? "Aggiorno..." : "Aggiorna prezzi";
  });
  bottoni(true);
  const { data, error } = await state.supabase.functions.invoke("aggiorna-quotazioni", { body: { azione: "posizioni" } });
  bottoni(false);
  if (error) return showFeedback(`Prezzi non aggiornati: ${await motivoErroreFunzione(error)}`, "error");
  const errori = data.filter((q) => q.errore);
  showFeedback(errori.length
    ? `Prezzi aggiornati; non trovati per ${errori.map((q) => `#${q.posizione} (${q.errore})`).join(", ")}.`
    : `Prezzi aggiornati per ${data.length} posizioni.`, errori.length ? "error" : "success");
  await reload();
}

// ---------------------------------------------------------------------------
// Proposte: segnali sui titoli della watchlist
// ---------------------------------------------------------------------------

const COLONNE_WATCHLIST = "isin,simbolo,nome,settore,note,valuta,prezzo,prezzo_eur,data_prezzo,var_1g,var_1m,var_3m,var_1a," +
  "massimo_52s,minimo_52s,sconto,sma50,sma200,rsi,volatilita,rendimento_div,trend,segnale,punteggio,motivi,andamento,errore,aggiornato_il";

const SEGNALI = {
  compra: { etichetta: "Compra", ordine: 0 },
  valuta: { etichetta: "Da valutare", ordine: 1 },
  attendi: { etichetta: "Attendi", ordine: 2 },
  evita: { etichetta: "Evita per ora", ordine: 3 }
};

const SETTORI = {
  "Financial Services": "Finanza",
  "Consumer Cyclical": "Beni di consumo",
  "Consumer Defensive": "Beni di prima necessità",
  "Communication Services": "Telecomunicazioni",
  Industrials: "Industria",
  Utilities: "Servizi di pubblica utilità",
  Technology: "Tecnologia",
  Energy: "Energia",
  Healthcare: "Salute",
  "Basic Materials": "Materie prime",
  "Real Estate": "Immobiliare"
};

// Importo per operazione e commissione: preferenze di questo browser
const IMPOSTAZIONI_PROPOSTE = { importo: ["myfinance:importo", "1000"], commissione: ["myfinance:commissione", "2,95"] };

function leggiImpostazione(nome) {
  const [chiave, predefinito] = IMPOSTAZIONI_PROPOSTE[nome];
  try {
    return localStorage.getItem(chiave) || predefinito;
  } catch {
    return predefinito;
  }
}

function salvaImpostazione(nome, valore) {
  try {
    localStorage.setItem(IMPOSTAZIONI_PROPOSTE[nome][0], valore);
  } catch {
    // Memoria del browser non disponibile: vale solo finché la pagina è aperta
  }
}

function percentuale(valore, segno = true) {
  if (valore === null || valore === undefined) return "—";
  return `${segno && valore > 0 ? "+" : ""}${valore.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
}

function prezzoTitolo(t) {
  if (t.prezzo === null) return "—";
  const cifre = t.prezzo < 10 ? 3 : 2;
  return `${t.prezzo.toLocaleString("it-IT", { minimumFractionDigits: cifre, maximumFractionDigits: cifre })} ${t.valuta === "EUR" ? "€" : t.valuta || ""}`;
}

// Il titolo nel registro investimenti: posizione aperta (con plusvalenza) o chiusa
function titoloInPortafoglio(isin) {
  const righe = state.investimenti.filter((r) => r.isin === isin);
  if (!righe.length) return null;
  const posizioni = [...new Set(righe.map((r) => r.posizione))];
  const aperta = posizioni.find((p) => statoPosizione(p).stato !== "chiusa");
  if (aperta !== undefined) {
    const q = state.quotazioni.get(aperta);
    const dettaglio = q?.quote ? `${formatQuantity(q.quote)} quote${q.plusvalenza !== null ? `, plusvalenza ${formatEuro(q.plusvalenza)}` : ""}` : "";
    return { aperta: true, posizione: aperta, testo: `Già in portafoglio${dettaglio ? `: ${dettaglio}` : ""}.` };
  }
  const chiusura = statoPosizione(posizioni[posizioni.length - 1]).data;
  return { aperta: false, posizione: posizioni[posizioni.length - 1], testo: `Posseduto in passato${chiusura ? ` (chiuso il ${formatDate(chiusura)})` : ""}.` };
}

// Titoli della watchlist dello stesso settore che hai già in portafoglio
function stessoSettoreInPortafoglio(t) {
  if (!t.settore) return [];
  return state.watchlist.filter((w) => w.isin !== t.isin && w.settore === t.settore && titoloInPortafoglio(w.isin)?.aperta);
}

// Quante azioni compri con l'importo scelto e quanto pesa la commissione
function calcoloAcquisto(t) {
  if (!t.prezzo_eur) return "";
  const importo = parseAmount(leggiImpostazione("importo")) || 1000;
  const commissione = parseAmount(leggiImpostazione("commissione")) ?? 2.95;
  const quote = Math.floor((importo - commissione) / t.prezzo_eur);
  if (quote < 1) return `Con ${formatEuro(importo)} non basta per un'azione (${formatEuro(t.prezzo_eur)}).`;
  const speso = quote * t.prezzo_eur;
  const peso = (commissione / speso) * 100;
  let testo = `Con ${formatEuro(importo)}: ${quote} ${quote === 1 ? "azione" : "azioni"} × ${formatEuro(t.prezzo_eur)} = ${formatEuro(speso)} + ${formatEuro(commissione)} di commissione (${percentuale(peso, false)}).`;
  if (peso > 0.5) testo += ` Commissione alta: da ${formatEuro(Math.ceil(commissione / 0.005))} in su scende sotto lo 0,5%.`;
  if (t.valuta && t.valuta !== "EUR") testo += ` Quotato in ${t.valuta}: il risultato dipende anche dal cambio.`;
  return testo;
}

// Andamento dell'ultimo anno (punti settimanali) con la media a 200 giorni tratteggiata
function sparkline(t) {
  const valori = (t.andamento || []).filter((v) => v !== null);
  if (valori.length < 2) return "";
  const riferimenti = t.sma200 ? [...valori, t.sma200] : valori;
  const min = Math.min(...riferimenti);
  const max = Math.max(...riferimenti);
  const y = (v) => (max === min ? 20 : 38 - ((v - min) / (max - min)) * 36);
  const x = (i) => (i / (valori.length - 1)) * 200;
  const linea = valori.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const colore = valori[valori.length - 1] >= valori[0] ? "var(--positive)" : "var(--negative)";
  const media = t.sma200 ? `<line x1="0" x2="200" y1="${y(t.sma200).toFixed(1)}" y2="${y(t.sma200).toFixed(1)}" class="sparkline-media"><title>Media a 200 giorni</title></line>` : "";
  return `<svg class="sparkline" viewBox="0 0 200 40" preserveAspectRatio="none" role="img" aria-label="Andamento dell'ultimo anno">
    ${media}<polyline points="${linea}" fill="none" stroke="${colore}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function ordinaProposte(titoli) {
  return [...titoli].sort((a, b) =>
    (SEGNALI[a.segnale]?.ordine ?? 9) - (SEGNALI[b.segnale]?.ordine ?? 9) || (b.punteggio ?? 0) - (a.punteggio ?? 0));
}

// Proposta del giorno: il "Compra" migliore, 10 punti in meno per ogni titolo dello stesso settore già posseduto
function propostaDelGiorno() {
  const candidati = state.watchlist
    .filter((t) => t.segnale === "compra" && !t.errore)
    .map((t) => ({ t, punti: (t.punteggio ?? 0) - 10 * stessoSettoreInPortafoglio(t).length }))
    .sort((a, b) => b.punti - a.punti);
  return candidati.map((c) => c.t);
}

function schedaTitolo(t) {
  const segnale = SEGNALI[t.segnale];
  const settore = SETTORI[t.settore] || t.settore || "";
  const portafoglio = titoloInPortafoglio(t.isin);
  const stessoSettore = stessoSettoreInPortafoglio(t);
  const contesto = [
    portafoglio?.testo,
    stessoSettore.length ? `Nello stesso settore hai già ${stessoSettore.map((w) => w.nome).join(", ")}.` : ""
  ].filter(Boolean);
  const metrica = (etichetta, valore, classe = "", titolo = "") =>
    `<div ${titolo ? `title="${escapeHtml(titolo)}"` : ""}><dt>${etichetta}</dt><dd class="${classe}">${valore}</dd></div>`;
  const colore = (v) => (v === null ? "" : v < 0 ? "negative" : "positive");
  const corpo = t.errore
    ? `<p class="errore-titolo">Analisi non riuscita: ${escapeHtml(t.errore)}</p>`
    : !t.aggiornato_il
      ? '<p class="hint">Non ancora analizzato: premi "Aggiorna analisi".</p>'
      : `
      ${sparkline(t)}
      <dl class="metriche">
        ${metrica("Prezzo", prezzoTitolo(t), "", t.data_prezzo ? `Chiusura del ${formatDate(t.data_prezzo)}` : "")}
        ${metrica("1 mese", percentuale(t.var_1m), colore(t.var_1m))}
        ${metrica("1 anno", percentuale(t.var_1a), colore(t.var_1a))}
        ${metrica("Dal massimo", t.sconto === null ? "—" : percentuale(-t.sconto), t.sconto > 0 ? "negative" : "", "Distanza dal massimo delle ultime 52 settimane")}
        ${metrica("RSI", t.rsi === null ? "—" : Math.round(t.rsi), t.rsi >= 70 || t.rsi <= 30 ? "evidenza" : "", "Forza relativa a 14 giorni: sopra 70 ipercomprato, sotto 30 ipervenduto")}
        ${metrica("Dividendi", t.rendimento_div ? percentuale(t.rendimento_div, false) : "—", "", "Dividendi dell'ultimo anno rispetto al prezzo")}
      </dl>
      <ul class="motivi">${(t.motivi || []).map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
      ${contesto.length ? `<p class="contesto">${escapeHtml(contesto.join(" "))}</p>` : ""}
      ${t.segnale === "compra" || t.segnale === "valuta" ? `<p class="acquisto">${escapeHtml(calcoloAcquisto(t))}</p>` : ""}`;
  return `
    <article class="titolo-card segnale-${t.segnale || "nessuno"}" data-isin="${escapeHtml(t.isin)}">
      <header>
        <div>
          <h3>${escapeHtml(t.nome || t.isin)}</h3>
          <span class="hint">${escapeHtml([t.simbolo, settore].filter(Boolean).join(" · "))}</span>
        </div>
        ${segnale ? `<span class="badge-segnale badge-${t.segnale}" title="Punteggio ${t.punteggio}/100">${segnale.etichetta}</span>` : ""}
      </header>
      ${corpo}
      <footer>
        ${t.aggiornato_il && !t.errore ? `<button class="link-button" type="button" data-azione="grafico">${state.graficoProposta === t.isin ? "Chiudi grafico" : "Grafico"}</button>` : ""}
        <button class="link-button danger" type="button" data-azione="rimuovi">Rimuovi</button>
        ${t.punteggio !== null && t.punteggio !== undefined ? `<span class="hint">Punteggio ${t.punteggio}/100</span>` : ""}
      </footer>
      ${state.graficoProposta === t.isin ? '<div class="grafico-proposta"><canvas></canvas></div>' : ""}
    </article>`;
}

function renderProposte() {
  if (!elements.proposteLista) return;
  if (document.activeElement !== elements.proposteImporto) elements.proposteImporto.value = leggiImpostazione("importo");
  if (document.activeElement !== elements.proposteCommissione) elements.proposteCommissione.value = leggiImpostazione("commissione");

  const date = state.watchlist.map((t) => t.data_prezzo).filter(Boolean).sort();
  const conteggi = Object.entries(SEGNALI)
    .map(([chiave, s]) => [s.etichetta, state.watchlist.filter((t) => t.segnale === chiave).length])
    .filter(([, n]) => n)
    .map(([etichetta, n]) => `${n} ${etichetta.toLowerCase()}`);
  elements.proposteInfo.textContent = !state.watchlist.length ? ""
    : `${state.watchlist.length} titoli${date.length ? ` · prezzi al ${formatDate(date[date.length - 1])}` : ""}${conteggi.length ? ` · ${conteggi.join(", ")}` : ""}`;

  // Proposta del giorno
  const proposte = propostaDelGiorno();
  if (!state.watchlist.length) {
    elements.propostaGiorno.innerHTML = '<p class="hint">La watchlist è vuota (o la tabella non esiste ancora): aggiungi un ISIN qui sotto.</p>';
  } else if (!state.watchlist.some((t) => t.aggiornato_il)) {
    elements.propostaGiorno.innerHTML = '<p class="hint">Nessuna analisi ancora: premi "Aggiorna analisi".</p>';
  } else if (!proposte.length) {
    const daValutare = state.watchlist.filter((t) => t.segnale === "valuta").map((t) => t.nome);
    elements.propostaGiorno.innerHTML = `
      <p class="proposta-titolo">Oggi nessuna proposta di acquisto</p>
      <p>Nessun titolo della watchlist è in un trend positivo con un ritracciamento: meglio aspettare.${daValutare.length ? ` Da valutare, con più rischio: ${escapeHtml(daValutare.join(", "))}.` : ""}</p>`;
  } else {
    const [migliore, ...altre] = proposte;
    elements.propostaGiorno.innerHTML = `
      <p class="proposta-titolo">Proposta del giorno: <strong>${escapeHtml(migliore.nome)}</strong> <span class="hint">${escapeHtml(migliore.simbolo || "")}</span></p>
      <ul class="motivi">${(migliore.motivi || []).map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
      <p class="acquisto">${escapeHtml(calcoloAcquisto(migliore))}</p>
      ${altre.length ? `<p class="hint">Anche in zona d'acquisto: ${escapeHtml(altre.map((t) => t.nome).join(", "))}.</p>` : ""}`;
  }

  elements.proposteLista.innerHTML = ordinaProposte(state.watchlist).map(schedaTitolo).join("");
  if (state.graficoProposta) disegnaGraficoProposta(state.graficoProposta);
}

// Grafico di un titolo: ultimo anno di prezzi con le medie a 50 e 200 giorni (storico caricato ora)
async function disegnaGraficoProposta(isin) {
  const canvas = elements.proposteLista.querySelector(`.titolo-card[data-isin="${CSS.escape(isin)}"] canvas`);
  if (!canvas) return;
  const { data, error } = await state.supabase.from("watchlist").select("storico").eq("isin", isin).single();
  if (error || !data?.storico?.length) return showFeedback("Storico non disponibile: premi \"Aggiorna analisi\".", "error");
  const chiusure = data.storico.map((p) => Number(p[1]));
  const mediaMobile = (n) => chiusure.map((_, i) => (i + 1 < n ? null : chiusure.slice(i + 1 - n, i + 1).reduce((s, v) => s + v, 0) / n));
  const inizio = Math.max(0, chiusure.length - 252);
  const taglia = (serie) => serie.slice(inizio);
  const etichette = taglia(data.storico.map((p) => formatDate(p[0])));
  drawChart("proposta", canvas, {
    type: "line",
    data: {
      labels: etichette,
      datasets: [
        { label: "Prezzo", data: taglia(chiusure), borderColor: "#3f6d56", backgroundColor: "#3f6d56", borderWidth: 1.6 },
        { label: "Media 50 giorni", data: taglia(mediaMobile(50)), borderColor: "#d08c2f", backgroundColor: "#d08c2f", borderWidth: 1.2 },
        { label: "Media 200 giorni", data: taglia(mediaMobile(200)), borderColor: "#8a8a8a", backgroundColor: "#8a8a8a", borderWidth: 1.2, borderDash: [5, 4] }
      ]
    },
    options: {
      maintainAspectRatio: false,
      elements: { point: { radius: 0 } },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: { x: { ticks: { maxTicksLimit: 6 } } }
    }
  });
}

async function aggiornaProposte() {
  elements.aggiornaProposte.disabled = true;
  elements.aggiornaProposte.textContent = "Analizzo...";
  const { data, error } = await state.supabase.functions.invoke("aggiorna-quotazioni", { body: { azione: "watchlist" } });
  elements.aggiornaProposte.disabled = false;
  elements.aggiornaProposte.textContent = "Aggiorna analisi";
  if (error) return showFeedback(`Analisi non aggiornata: ${await motivoErroreFunzione(error)}`, "error");
  const errori = Array.isArray(data) ? data.filter((t) => t.errore) : [];
  showFeedback(errori.length
    ? `Analisi aggiornata; non riuscita per ${errori.map((t) => `${t.isin} (${t.errore})`).join(", ")}.`
    : `Analisi aggiornata per ${Array.isArray(data) ? data.length : 0} titoli.`, errori.length ? "error" : "success");
  await reload();
}

async function aggiungiAllaWatchlist(event) {
  event.preventDefault();
  const isin = elements.watchlistIsin.value.trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return showFeedback("ISIN non valido: 2 lettere, 9 caratteri e una cifra (es. IT0003132476).", "error");
  if (state.watchlist.some((t) => t.isin === isin)) return showFeedback("Questo ISIN è già nella watchlist.", "error");
  const { error } = await state.supabase.from("watchlist").insert({ isin });
  if (error) return showFeedback(`Non aggiunto: ${error.message}`, "error");
  elements.watchlistIsin.value = "";
  showFeedback(`${isin} aggiunto: lo analizzo...`);
  await aggiornaProposte();
}

async function rimuoviDallaWatchlist(isin) {
  const titolo = state.watchlist.find((t) => t.isin === isin);
  if (!confirm(`Togliere ${titolo?.nome || isin} dalla watchlist?`)) return;
  const { error } = await state.supabase.from("watchlist").delete().eq("isin", isin);
  if (error) return showFeedback(`Non rimosso: ${error.message}`, "error");
  if (state.graficoProposta === isin) state.graficoProposta = null;
  showFeedback(`${titolo?.nome || isin} tolto dalla watchlist.`);
  await reload();
}

// Sul telefono le tabelle con classe "tabella-schede" diventano schede (styles.css): ogni
// cella prende come etichetta il titolo della sua colonna. A destra del nome una freccia che
// porta alle operazioni, perché lì il tocco sul nome apre e chiude la scheda.
function etichettaColonne(table) {
  const titoli = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  // la riga dei totali (tfoot) resta sempre aperta
  table.querySelectorAll("tfoot tr").forEach((tr) => tr.classList.add("aperta"));
  table.querySelectorAll("tbody tr, tfoot tr").forEach((tr) => {
    [...tr.children].forEach((cella, i) => {
      if (titoli[i]) cella.dataset.label = titoli[i];
    });
    const link = tr.querySelector(":scope > .clickable");
    if (!link) return;
    const freccia = document.createElement("span");
    freccia.className = "solo-schede vedi-operazioni clickable";
    Object.assign(freccia.dataset, link.dataset);
    delete freccia.dataset.label;
    freccia.setAttribute("role", "button");
    freccia.setAttribute("aria-label", "Vedi le operazioni");
    freccia.title = "Vedi le operazioni";
    freccia.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>';
    link.append(freccia);
  });
}

// Telefono: un tocco sulla scheda la apre o la chiude; la freccia accanto al nome porta al
// registro (come il nome sul computer)
function apriChiudiScheda(event) {
  if (!schermoStretto()) return;
  const riga = event.target.closest("tbody tr");
  if (!riga || event.target.closest(".vedi-operazioni")) return;
  event.stopPropagation();
  riga.classList.toggle("aperta");
}

// Riga "Conto Fineco" nella tabella Posizioni: costi (bollo, Tobin tax, imposte) e interessi
// sulla liquidità, che non appartengono a una posizione ma pesano sul risultato
function rigaContoFineco(costi, interessi) {
  if (!state.costiFineco.length) return "";
  const risultato = round2(costi + interessi);
  return `
    <tr class="riga-fineco" title="Dal conto Fineco: costi ${formatEuro(costi)}, interessi sulla liquidità ${formatEuro(interessi)}">
      <th class="clickable" data-tipo="Conto Fineco">Conto Fineco: costi e interessi</th>
      <td class="num"><span class="zero">—</span></td><td>Conto Fineco</td><td></td>
      ${cell(0)}${cell(0)}${cell(interessi)}${cell(interessi)}
      ${cell(risultato, risultato < 0 ? "negative" : "positive")}
      ${cell(risultato, risultato < 0 ? "negative" : "positive")}
      <td></td><td></td><td></td>
    </tr>`;
}

function renderInvestimenti() {
  const righe = investimentiVisibili();
  const posizioni = riepilogoPosizioni(righe);
  const sommaFineco = (operazione) => round2(state.costiFineco.filter((r) => r.operazione === operazione).reduce((s, r) => s + r.importo, 0));
  const costiConto = sommaFineco("Costi e tasse");
  const interessiConto = sommaFineco("Interessi liquidità");

  elements.posizioniTable.innerHTML = !posizioni.length
    ? '<tbody><tr><td class="empty">Nessun investimento.</td></tr></tbody>'
    : `
    <thead><tr>
      <th>Nome</th><th class="num">ID</th><th>Tipo</th><th>Stato</th><th class="num">Capitale impegnato</th><th class="num">Rimborsi</th>
      <th class="num">Interessi</th><th class="num">Capitale maturato</th><th class="num">Risultato</th>
      <th class="num" title="Risultato meno la tassa del ${ALIQUOTA_PLUSVALENZE * 100}% sulla plusvalenza delle posizioni aperte">Risultato netto</th>
      <th class="num">Rend. %</th><th class="num">Durata (anni)</th><th class="num">Rend. % annuo</th>
    </tr></thead>
    <tbody>${posizioni.map((p) => {
      const netto = p.risultato - tassaPlusvalenza(p.posizione);
      const stato = statoPosizione(p.posizione);
      return `
      <tr class="${daControllare(p.posizione) ? "da-controllare" : ""} ${stato.stato === "chiusa" ? "chiusa" : ""}" ${titoloQuotazione(p.posizione)}>
        <th class="clickable" data-posizione="${p.posizione}"><span class="nome-scheda">${escapeHtml(p.nome)}</span><span class="stato stato-${stato.stato} solo-schede">${stato.testo}</span></th>
        <td class="num">${p.posizione}</td>
        <td>${escapeHtml(p.tipo)}</td>
        <td><span class="stato stato-${stato.stato}">${stato.testo}</span></td>
        ${cell(p.impegnato)}${cell(p.rimborsi)}${cell(p.interessi)}${cell(p.maturato)}
        ${cell(p.risultato, p.risultato < 0 ? "negative" : "positive")}
        ${cell(netto, netto < 0 ? "negative" : "positive")}
        <td class="num ${p.rendimento < 0 ? "negative" : ""}">${percent(p.rendimento)}</td>
        <td class="num">${p.durata.toLocaleString("it-IT", { maximumFractionDigits: 2 })}</td>
        <td class="num">${percent(p.annuo)}</td>
      </tr>`;
    }).join("")}${rigaContoFineco(costiConto, interessiConto)}</tbody>`;
  etichettaColonne(elements.posizioniTable);
  renderQuotazioniInfo();
  renderMercato();

  const tipi = new Map();
  for (const p of posizioni) {
    const t = tipi.get(p.tipo) || { impegnato: 0, maturato: 0 };
    t.impegnato += p.impegnato;
    t.maturato += p.maturato;
    tipi.set(p.tipo, t);
  }
  // Costi e interessi del conto Fineco: nessun capitale impegnato, solo risultato
  const tipiConFineco = new Map(tipi);
  if (state.costiFineco.length) tipiConFineco.set("Conto Fineco", { impegnato: 0, maturato: costiConto + interessiConto });
  const totale = { impegnato: 0, maturato: 0 };
  const tipoRow = (nome, t, tag = "td", link = "") => {
    const risultato = t.maturato - t.impegnato;
    return `<tr><th ${link}>${escapeHtml(nome || "—")}</th>${cell(t.impegnato)}${cell(t.maturato)}
      ${cell(risultato, risultato < 0 ? "negative" : "positive")}
      <${tag} class="num">${percent(t.impegnato ? (risultato / t.impegnato) * 100 : null)}</${tag}></tr>`;
  };
  const tipiRows = [...tipiConFineco.entries()].sort(([a], [b]) => a.localeCompare(b, "it")).map(([nome, t]) => {
    totale.impegnato += t.impegnato;
    totale.maturato += t.maturato;
    return tipoRow(nome, t, "td", `class="clickable" data-tipo="${escapeHtml(nome || "")}"`);
  }).join("");
  elements.tipiTable.innerHTML = !tipi.size ? "" : `
    <thead><tr><th>Tipo</th><th class="num">Capitale impegnato</th><th class="num">Capitale maturato</th><th class="num">Risultato</th><th class="num">Rend. %</th></tr></thead>
    <tbody>${tipiRows}</tbody>
    <tfoot>${tipoRow("Totale", totale)}</tfoot>`;
  etichettaColonne(elements.tipiTable);

  const oggi = todayISO();
  // Il registro mostra sempre tutte le operazioni, anche quelle future (in corsivo)
  // Ordinamento scelto dalle intestazioni (a parità di valore, per data e id)
  const { colonna, crescente } = state.ordinamentoInv;
  const confronta = (a, b) => {
    const va = a[colonna] ?? "";
    const vb = b[colonna] ?? "";
    const diff = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "it");
    return diff || a.data.localeCompare(b.data) || String(a.id).localeCompare(String(b.id), "it", { numeric: true });
  };
  renderFiltriInv();
  // Con le operazioni anche costi e interessi del conto Fineco (sola lettura)
  const tutte = [...state.investimenti, ...state.costiFineco];
  const operazioni = filtraInvestimenti(tutte).sort((a, b) => (crescente ? confronta(a, b) : confronta(b, a)));
  const saldoFiltrato = operazioni.reduce((s, r) => s + r.importo, 0);
  elements.invTotali.textContent = operazioni.length === tutte.length ? ""
    : `${operazioni.length} operazioni · saldo ${formatEuro(saldoFiltrato)}`;
  // L'ultima operazione già avvenuta (la più recente fino a oggi) è evidenziata in verde
  const ultima = state.investimenti
    .filter((riga) => riga.data <= oggi)
    .reduce((u, riga) => (!u || riga.data > u.data || (riga.data === u.data && riga.id > u.id) ? riga : u), null);
  renderSortIndicators(elements.sortButtonsInv, "sortInv", state.ordinamentoInv);
  const rigaFineco = (riga) => `
    <tr class="riga-fineco" title="Dal conto Fineco: si aggiorna con + Excel Fineco">
      <td data-label="Data">${formatDate(riga.data)}</td>
      <td data-label="ID" class="num"><span class="zero">—</span></td>
      <td data-label="Nome">${escapeHtml(riga.nome)}</td>
      <td data-label="Tipo">${escapeHtml(riga.tipo)}</td>
      <td data-label="Operazione">${escapeHtml(riga.operazione)}</td>
      <td data-label="Quantità"></td><td data-label="ABP"></td>
      <td data-label="Importo" class="num ${riga.importo < 0 ? "negative" : "positive"}">${formatNumber(riga.importo)}</td>
      <td data-label="Note">${escapeHtml(riga.note || "")}</td>
      <td class="actions"></td>
    </tr>`;
  elements.operazioniBody.innerHTML = (state.editingInvestimentoId === "nuova" ? rigaInvestimentoInModifica(null) : "") + operazioni.map((riga) => (riga.fineco ? rigaFineco(riga) : riga.id === state.editingInvestimentoId ? rigaInvestimentoInModifica(riga) : `
    <tr class="${riga.data > oggi ? "future" : ""} ${riga === ultima ? "ultima" : ""} ${riga.domani && daControllare(riga.posizione) ? "da-controllare" : ""}" ${riga.domani && daControllare(riga.posizione) ? titoloQuotazione(riga.posizione) : riga === ultima ? 'title="Ultima operazione avvenuta"' : riga.domani ? 'title="Valore attuale: la data è sempre domani (come =OGGI()+1 nell\'Excel)"' : riga.data > oggi ? 'title="Operazione prevista"' : ""}>
      <td data-label="Data">${formatDate(riga.data)}</td>
      <td data-label="ID" class="num">${riga.posizione}</td>
      <td data-label="Nome">${escapeHtml(riga.nome)}</td>
      <td data-label="Tipo">${escapeHtml(riga.tipo || "")}</td>
      <td data-label="Operazione">${escapeHtml(riga.operazione)}</td>
      <td data-label="Quantità" class="num">${formatQuantity(riga.quantita)}</td>
      <td data-label="ABP" class="num">${riga.abp === null ? "" : formatQuantity(riga.abp)}</td>
      <td data-label="Importo" class="num ${riga.importo < 0 ? "negative" : "positive"}">${formatNumber(riga.importo)}</td>
      <td data-label="Note">${escapeHtml(riga.note || "")}</td>
      <td class="actions">
        <button class="icon-button" type="button" data-action="inv-edit" data-id="${riga.id}" title="Modifica" aria-label="Modifica">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="icon-button danger" type="button" data-action="inv-delete" data-id="${riga.id}" title="Elimina" aria-label="Elimina">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </td>
    </tr>`)).join("") || `<tr><td colspan="10" class="empty">${state.investimenti.length ? "Nessuna operazione con questi filtri." : "Nessuna operazione."}</td></tr>`;

  renderInvestimentiCharts(righe, tipi);

  const nomi = [...new Set(state.investimenti.map((r) => r.nome))].sort((a, b) => a.localeCompare(b, "it"));
  elements.investimentiList.innerHTML = nomi.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
  const tipiNomi = [...new Set(state.investimenti.map((r) => r.tipo).filter(Boolean))].sort();
  elements.tipiList.innerHTML = tipiNomi.map((t) => `<option value="${escapeHtml(t)}"></option>`).join("");
}

// Grafici come nel foglio: torta per tipo e andamento cumulato delle operazioni
function renderInvestimentiCharts(righe, tipi) {
  const oggi = todayISO();
  // Totali cumulati: capitale investito (positivo), rimborsi, cedole e dividendi (con gli
  // interessi sulla liquidità Fineco) e costi del conto Fineco (positivi: bollo, Tobin tax, imposte)
  const cumulati = { investito: 0, rimborsi: 0, cedole: 0, costi: 0 };
  const punti = [];
  const sintesi = { investito: 0, restituito: 0, interessi: 0 };
  for (const riga of [...righe, ...state.costiFineco].sort((a, b) => a.data.localeCompare(b.data))) {
    if (riga.operazione === "Investimento") cumulati.investito -= riga.importo;
    else if (riga.operazione === "Rimborso") cumulati.rimborsi += riga.importo;
    else if (riga.operazione === "Costi e tasse") cumulati.costi -= riga.importo;
    else cumulati.cedole += riga.importo;
    punti.push({ data: riga.data, ...cumulati });
    if (riga.data <= oggi && !riga.fineco) {
      if (riga.operazione === "Investimento") sintesi.investito += -riga.importo;
      else if (riga.operazione === "Rimborso") sintesi.restituito += riga.importo;
      else sintesi.interessi += riga.importo;
    }
  }

  elements.investimentiSintesi.innerHTML = `Ad oggi (${formatDate(oggi)}):
    capitale investito <strong>${formatEuro(sintesi.investito)}</strong> ·
    capitale restituito <strong>${formatEuro(sintesi.restituito)}</strong> ·
    interessi e dividendi <strong class="positive">${formatEuro(sintesi.interessi)}</strong>`;

  // Conto Fineco: liquidità (somma di tutti i movimenti del conto), costi e interessi
  const fineco = state.fineco;
  elements.finecoSintesi.classList.toggle("hidden", !fineco);
  if (fineco) {
    elements.finecoSintesi.innerHTML = `Conto Fineco (ultimo movimento ${formatDate(fineco.ultimaData)}):
      liquidità <strong>${formatEuro(fineco.liquidita)}</strong> ·
      costi (bollo, Tobin tax, imposte) <strong class="negative">${formatEuro(fineco.tipi.get("Costi") || 0)}</strong> ·
      interessi sulla liquidità <strong class="positive">${formatEuro(fineco.tipi.get("Interessi") || 0)}</strong>`;
  }

  const tipiOrdinati = [...tipi.entries()].sort(([a], [b]) => a.localeCompare(b, "it"));
  drawChart("tipi", elements.chartTipi, {
    type: "pie",
    data: {
      labels: tipiOrdinati.map(([nome]) => nome || "—"),
      datasets: [{
        data: tipiOrdinati.map(([, t]) => round2(t.impegnato)),
        backgroundColor: tipiOrdinati.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: schermoStretto() ? "bottom" : "right" },
        tooltip: {
          callbacks: {
            label: (item) => {
              const total = item.dataset.data.reduce((sum, v) => sum + v, 0);
              return `${item.label}: ${formatEuro(item.raw)} (${Math.round((item.raw / total) * 100)}%)`;
            }
          }
        }
      }
    },
    plugins: [percentLabels]
  });

  // Asse x per date vere (millisecondi), con una tacca a inizio di ogni anno
  const giorno = (iso) => new Date(`${iso}T00:00:00`).getTime();
  const linea = (label, colore, valore) => ({
    label,
    data: punti.map((p) => ({ x: giorno(p.data), y: round2(valore(p)) })),
    borderColor: colore,
    backgroundColor: colore
  });
  const primoAnno = punti.length ? Number(punti[0].data.slice(0, 4)) : 0;
  const ultimoAnno = punti.length ? Number(punti[punti.length - 1].data.slice(0, 4)) : 0;

  drawChart("investimenti", elements.chartInvestimenti, {
    type: "line",
    data: {
      datasets: [
        linea("Capitale investito", "#4472c4", (p) => p.investito),
        linea("Rimborsi", "#ed7d31", (p) => p.rimborsi),
        linea(state.costiFineco.length ? "Cedole, dividendi e interessi" : "Cedole e dividendi", "#2e8b57", (p) => p.cedole),
        ...(state.costiFineco.length ? [linea("Costi e tasse", "#c0392b", (p) => p.costi)] : []),
        // Negativo: soldi ancora investiti; sopra zero: guadagno (costi compresi)
        linea("Saldo netto (rientrato − investito − costi)", "#8a8a8a", (p) => p.rimborsi + p.cedole - p.investito - p.costi)
      ]
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0 }, line: { stepped: true } },
      plugins: {
        legend: senzaLegenda(),
        zoom: opzioniZoom(elements.chartInvestimenti, 60 * 86400000), // almeno due mesi
        lineaOggi: { posizione: punti.length ? giorno(oggi) : null },
        tooltip: valoriSottoIlGrafico
      },
      scales: {
        x: {
          type: "linear",
          min: giorno(`${primoAnno}-01-01`),
          max: giorno(`${ultimoAnno + 1}-01-01`),
          afterBuildTicks: (scala) => {
            // Ingrandito su meno di due anni (zoom): tacche al primo di ogni mese (o ogni 3 mesi)
            if (scala.max - scala.min < 2 * 365 * 86400000) {
              const mesi = (scala.max - scala.min) / (30 * 86400000);
              const passo = mesi > (schermoStretto() ? 6 : 12) ? 3 : 1;
              scala.ticks = [];
              const d = new Date(scala.min);
              for (let m = new Date(d.getFullYear(), d.getMonth() + 1, 1); m.getTime() <= scala.max; m.setMonth(m.getMonth() + passo)) {
                scala.ticks.push({ value: m.getTime() });
              }
              return;
            }
            scala.ticks = [];
            // sul telefono un anno sì e uno no, altrimenti le etichette si toccano
            const passo = schermoStretto() ? 2 : 1;
            for (let anno = primoAnno; anno <= ultimoAnno + 1; anno += passo) scala.ticks.push({ value: giorno(`${anno}-01-01`) });
          },
          ticks: {
            callback(valore) {
              const data = new Date(valore);
              return this.max - this.min < 2 * 365 * 86400000
                ? `${MESI[data.getMonth()]} ${String(data.getFullYear()).slice(2)}`
                : data.getFullYear();
            },
            maxRotation: 0,
            autoSkip: true
          }
        },
        y: { ticks: { callback: (value) => formatEuroBreve(value) } }
      },
      layout: { padding: { top: 14 } }
    },
    plugins: [lineaOggi, lineaCursore]
  });
  // All'inizio i valori di oggi: l'ultima operazione già avvenuta
  iniziaValori("investimenti", (i) => formatDate(punti[i].data), punti.findLastIndex((p) => p.data <= oggi));
}

// Registro investimenti modificabile in linea, come la lista Movimenti: la matita trasforma
// la riga in campi, "+ Nuova operazione" aggiunge in cima una riga vuota ("nuova")
function rigaInvestimentoInModifica(riga) {
  const nuova = !riga;
  const r = riga || { data: todayISO(), domani: false, operazione: "Investimento" };
  const numero = (v) => (v === null || v === undefined ? "" : String(Math.abs(v)).replace(".", ","));
  const campo = (nome, valore, extra = "", classe = "riga-input") =>
    `<input class="${classe}" data-campo="${nome}" value="${escapeHtml(valore ?? "")}" ${extra} autocomplete="off">`;
  const importoCampo = (nome, valore, etichetta, classe = "riga-input num-input") =>
    campo(nome, numero(valore), `type="text" inputmode="decimal" aria-label="${etichetta}" placeholder="${etichetta}"`, classe);
  const secondario = "riga-input dettagli-input";
  return `
    <tr class="editing" data-id="${nuova ? "nuova" : r.id}">
      <td>
        ${campo("data", r.domani ? tomorrowISO() : r.data, `type="date" aria-label="Data" ${r.domani ? "disabled" : ""}`)}
        <label class="check-field dettagli-input" title="Valore attuale di una posizione aperta, come se la chiudessi domani: la data resta sempre domani">
          <input type="checkbox" data-campo="domani" ${r.domani ? "checked" : ""}> Sempre domani
        </label>
      </td>
      <td class="num">${campo("posizione", r.posizione, 'type="number" min="0" step="1" aria-label="ID posizione" placeholder="ID" title="Stesso ID per le operazioni dello stesso investimento"', "riga-input num-input")}</td>
      <td>
        ${campo("nome", r.nome, 'type="text" list="investimenti-list" aria-label="Nome" placeholder="Nome (es. BTP...)"')}
        ${campo("isin", r.isin, 'type="text" aria-label="ISIN" placeholder="ISIN"', secondario)}
        ${campo("prodotto", r.prodotto, 'type="text" aria-label="Prodotto" placeholder="Prodotto"', secondario)}
      </td>
      <td>${campo("tipo", r.tipo, 'type="text" list="tipi-list" aria-label="Tipo" placeholder="Tipo"')}</td>
      <td>
        <select class="riga-input" data-campo="operazione" aria-label="Operazione">
          ${["Investimento", "Rimborso", "Cedola", "Dividendi"].map((o) => `<option ${o === r.operazione ? "selected" : ""}>${o}</option>`).join("")}
        </select>
      </td>
      <td class="num">${importoCampo("quantita", r.quantita, "Quantità")}</td>
      <td class="num">${campo("abp", numero(r.abp), 'type="text" inputmode="decimal" aria-label="ABP" placeholder="ABP" title="Prezzo medio di carico dopo questa operazione, copiato dal conto: aggiorna il valore della posizione"', "riga-input num-input")}</td>
      <td class="num">
        ${importoCampo("importo", r.importo, "Importo €")}
        ${importoCampo("commissioni", r.commissioni, "Commissioni", `${secondario} num-input`)}
        ${importoCampo("tassa", r.tassa, "Tassa", `${secondario} num-input`)}
      </td>
      <td>${campo("note", r.note, 'type="text" aria-label="Note" placeholder="Note"')}</td>
      <td class="actions">
        <button class="icon-button" type="button" data-action="inv-save" title="Salva (Invio)" aria-label="Salva">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </button>
        <button class="icon-button" type="button" data-action="inv-cancel" title="Annulla (Esc)" aria-label="Annulla">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </td>
    </tr>`;
}

// Filtri del registro: posizione, operazione, tipo, anno e testo (nome, ISIN, note)
function filtraInvestimenti(righe) {
  const f = state.filtriInv;
  const testo = normalize(f.testo);
  return righe.filter((r) =>
    (f.posizione === "" || r.posizione === Number(f.posizione)) &&
    (!f.stato || (!r.fineco && (f.stato === "chiusa") === (statoPosizione(r.posizione).stato === "chiusa"))) &&
    (!f.operazione || r.operazione === f.operazione) &&
    (!f.tipo || (r.tipo || "") === f.tipo) &&
    (!f.anno || r.data.startsWith(f.anno)) &&
    (!testo || testoRicerca(r).includes(testo)));
}

// La ricerca cerca in tutto: nome, ISIN, prodotto, tipo, operazione, ID, data, importo, note
function testoRicerca(r) {
  return normalize([
    r.nome, r.isin, r.prodotto, r.tipo, r.operazione, r.posizione, formatDate(r.data),
    formatNumber(r.importo), String(Math.abs(r.importo)).replace(".", ","), r.note
  ].filter((v) => v !== null && v !== undefined).join(" "));
}

function renderFiltriInv() {
  const f = state.filtriInv;
  const opzioni = (tutte, valori, scelto) => `<option value="">${tutte}</option>` + valori
    .map(([valore, etichetta]) => `<option value="${escapeHtml(valore)}" ${String(valore) === scelto ? "selected" : ""}>${escapeHtml(etichetta)}</option>`)
    .join("");
  const posizioni = new Map(state.investimenti.map((r) => [r.posizione, r.nome]));
  elements.invFiltri.posizione.innerHTML = opzioni("Tutte le posizioni",
    [...posizioni].sort(([a], [b]) => a - b).map(([id, nome]) => [id, `${id} · ${nome}`]), f.posizione);
  elements.invFiltri.stato.innerHTML = opzioni("Aperte e chiuse", [["aperta", "Solo aperte"], ["chiusa", "Solo chiuse"]], f.stato);
  const tutte = [...state.investimenti, ...state.costiFineco];
  elements.invFiltri.operazione.innerHTML = opzioni("Tutte le operazioni",
    ["Investimento", "Rimborso", "Cedola", "Dividendi", ...(state.costiFineco.length ? ["Costi e tasse", "Interessi liquidità"] : [])].map((o) => [o, o]), f.operazione);
  elements.invFiltri.tipo.innerHTML = opzioni("Tutti i tipi",
    [...new Set(tutte.map((r) => r.tipo).filter(Boolean))].sort().map((t) => [t, t]), f.tipo);
  elements.invFiltri.anno.innerHTML = opzioni("Tutti gli anni",
    [...new Set(tutte.map((r) => r.data.slice(0, 4)))].sort().reverse().map((a) => [a, a]), f.anno);
  if (elements.invFiltri.testo.value !== f.testo) elements.invFiltri.testo.value = f.testo;
  // Telefono: i filtri avanzati si aprono da soli se uno è impostato (es. dalla freccia di una posizione)
  if (f.posizione !== "" || f.stato || f.operazione || f.tipo || f.anno) apriFiltriAvanzati("inv-filtri", true);
}

// Telefono: le tendine dei filtri (Movimenti e Posizioni) compaiono con "Avanzate"
function apriFiltriAvanzati(id, aperti) {
  const contenitore = document.getElementById(id);
  contenitore.classList.toggle("avanzate-aperte", aperti);
  contenitore.querySelector(".filtri-avanzate-pulsante").setAttribute("aria-expanded", String(aperti));
}

// Link dalla Dashboard investimenti: apre il registro filtrato su una posizione o un tipo
function openInvestimentiFiltrati(filtri) {
  state.filtriInv = { posizione: "", stato: "", operazione: "", tipo: "", anno: "", testo: "", ...filtri };
  showView("investimenti");
  renderInvestimenti();
  window.scrollTo(0, 0);
}

function startEditInvestimento(id) {
  state.editingInvestimentoId = id;
  renderInvestimenti();
  const campo = elements.operazioniBody.querySelector(`tr.editing [data-campo="${id === "nuova" ? "nome" : "importo"}"]`);
  campo?.focus();
  campo?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function annullaInvestimento() {
  state.editingInvestimentoId = null;
  renderInvestimenti();
}

// Nuova operazione: scegliendo un nome già usato compila ID, ISIN, prodotto e tipo;
// un nome nuovo prende il prossimo ID
function compilaDaNome(riga) {
  const campo = (nome) => riga.querySelector(`[data-campo="${nome}"]`);
  const nome = normalize(campo("nome").value);
  const precedenti = state.investimenti.filter((r) => normalize(r.nome) === nome);
  const ultimo = precedenti[precedenti.length - 1];
  if (ultimo) {
    campo("posizione").value = ultimo.posizione;
    campo("isin").value = ultimo.isin || "";
    campo("prodotto").value = ultimo.prodotto || "";
    campo("tipo").value = ultimo.tipo || "";
  } else if (!campo("posizione").value) {
    campo("posizione").value = Math.max(-1, ...state.investimenti.map((r) => r.posizione)) + 1;
  }
}

// Nuova operazione: scrivendo l'ID di una posizione esistente compila nome, ISIN, prodotto
// e tipo dalla sua ultima operazione. Se poi l'ID diventa uno che non esiste (es. da "1" a
// "17" mentre si scrive), i campi compilati così si svuotano; quelli scritti a mano restano.
function compilaDaPosizione(riga) {
  const campi = ["nome", "isin", "prodotto", "tipo"].map((nome) => riga.querySelector(`[data-campo="${nome}"]`));
  const testo = riga.querySelector('[data-campo="posizione"]').value;
  const precedenti = testo === "" ? [] : state.investimenti.filter((r) => r.posizione === Number(testo));
  const ultimo = precedenti[precedenti.length - 1];
  if (ultimo) {
    [ultimo.nome, ultimo.isin, ultimo.prodotto, ultimo.tipo].forEach((valore, i) => { campi[i].value = valore || ""; });
    riga.dataset.autocompilata = "si";
  } else if (riga.dataset.autocompilata) {
    campi.forEach((c) => { c.value = ""; });
    delete riga.dataset.autocompilata;
  }
}

async function salvaInvestimento() {
  const riga = elements.operazioniBody.querySelector("tr.editing");
  if (!riga) return;
  const campo = (nome) => riga.querySelector(`[data-campo="${nome}"]`);
  const testo = (nome) => campo(nome).value.trim();
  const opzionale = (nome) => (testo(nome) ? parseAmount(testo(nome)) : null);
  const importo = parseAmount(testo("importo"));
  const domani = campo("domani").checked;
  if (!testo("nome")) return showFeedback("Manca il nome.", "error");
  if (testo("posizione") === "") return showFeedback("Manca l'ID della posizione.", "error");
  if (!domani && !testo("data")) return showFeedback("Data non valida.", "error");
  if (importo === null || importo === 0) return showFeedback("Importo non valido.", "error");
  const operazione = campo("operazione").value;
  const record = {
    data: domani ? tomorrowISO() : testo("data"),
    domani,
    posizione: Number(testo("posizione")),
    nome: testo("nome"),
    isin: testo("isin") || null,
    prodotto: testo("prodotto") || null,
    tipo: testo("tipo") || null,
    operazione,
    quantita: opzionale("quantita"),
    // Come nell'Excel: l'investimento è un'uscita (negativo), il resto positivo
    importo: operazione === "Investimento" ? -Math.abs(importo) : Math.abs(importo),
    commissioni: opzionale("commissioni"),
    tassa: opzionale("tassa"),
    abp: opzionale("abp"),
    note: testo("note") || null
  };
  const nuova = state.editingInvestimentoId === "nuova";
  const { error } = nuova
    ? await state.supabase.from("investimenti").insert(record)
    : await state.supabase.from("investimenti").update(record).eq("id", state.editingInvestimentoId);
  if (error) return showFeedback(`Salvataggio non riuscito: ${error.message}`, "error");
  state.editingInvestimentoId = null;
  showFeedback(nuova ? "Operazione aggiunta." : "Operazione aggiornata.");
  await reload();
  // Un ABP nuovo cambia il valore della posizione: ricalcola subito la plusvalenza
  if (record.abp) await aggiornaPrezzi();
}

async function deleteInvestimento(id) {
  const riga = state.investimenti.find((r) => r.id === id);
  if (!riga || !confirm(`Eliminare "${riga.operazione} ${riga.nome}" del ${formatDate(riga.data)}?`)) return;
  const { error } = await state.supabase.from("investimenti").delete().eq("id", id);
  if (error) return showFeedback(`Eliminazione non riuscita: ${error.message}`, "error");
  if (state.editingInvestimentoId === id) state.editingInvestimentoId = null;
  showFeedback("Operazione eliminata.");
  await reload();
}

// ---------------------------------------------------------------------------
// Navigazione ed eventi
// ---------------------------------------------------------------------------

// Ogni gruppo ricorda la voce scelta per ultima (.selected); il gruppo della vista aperta è .current
function renderTabs(view) {
  document.querySelectorAll(".switch").forEach((sw) => {
    const voci = [...sw.querySelectorAll(".tab")];
    const scelta = voci.find((tab) => tab.dataset.view === view);
    if (scelta) voci.forEach((tab) => tab.classList.toggle("selected", tab === scelta));
    voci.forEach((tab) => {
      const attivo = tab === scelta;
      tab.classList.toggle("active", attivo);
      tab.setAttribute("aria-selected", String(attivo));
      // Con Tab si entra in ogni interruttore sulla voce scelta, poi si usano le frecce
      tab.tabIndex = tab.classList.contains("selected") ? 0 : -1;
    });
    sw.closest(".switch-group").classList.toggle("current", Boolean(scelta));
  });
  posizionaCursori();
}

// Il cursore di ogni interruttore va sotto la voce scelta: posizione e larghezza della voce,
// perché ogni voce è larga quanto la sua parola (da ricalcolare se cambia la larghezza)
function posizionaCursori() {
  document.querySelectorAll(".switch").forEach((sw) => {
    const voce = sw.querySelector(".tab.selected") || sw.querySelector(".tab");
    sw.style.setProperty("--x", `${voce.offsetLeft}px`);
    sw.style.setProperty("--w", `${voce.offsetWidth}px`);
  });
}

function showSection(view) {
  elements.viewMovimenti.classList.toggle("hidden", view !== "movimenti");
  elements.viewDashboard.classList.toggle("hidden", view !== "dashboard");
  elements.viewInvestimenti.classList.toggle("hidden", view !== "investimenti");
  elements.viewDashboardInvestimenti.classList.toggle("hidden", view !== "dashboard-investimenti");
  elements.viewProposte.classList.toggle("hidden", view !== "proposte");
}

function showView(view) {
  renderTabs(view);
  try {
    localStorage.setItem("myfinance:view", view);
  } catch {
    // Memoria del browser non disponibile: pazienza
  }
  showSection(view);
  // I grafici disegnati mentre la sezione era nascosta vanno ridisegnati
  if (view === "dashboard") renderDashboard();
  if (view === "investimenti" || view === "dashboard-investimenti") renderInvestimenti();
  if (view === "proposte") renderProposte();
  if (view === "movimenti" && !state.lista.finita) watchListaFine();
}

function renderAll() {
  renderYearSelect();
  renderFilters();
  renderDashboard();
  renderInvestimenti();
  renderProposte();
}

// Click su un importo della dashboard: apre i movimenti filtrati per anno, mese e categoria
function openMovimentiFiltrati(anno, mese, categoria) {
  elements.filterAnno.value = anno ?? "";
  elements.filterMese.value = mese ?? "";
  elements.filterCategoria.value = categoria;
  elements.filterTesto.value = "";
  if (anno || mese || categoria) apriFiltriAvanzati("mov-filtri", true);
  showView("movimenti");
  window.scrollTo(0, 0);
  loadMovimentiPage(true);
}

function bindEvents() {
  elements.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  // Frecce sinistra/destra: si sposta tra le voci dello stesso interruttore
  document.querySelectorAll(".switch").forEach((sw) => sw.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const voci = [...sw.querySelectorAll(".tab")];
    const passo = event.key === "ArrowRight" ? 1 : -1;
    const prossima = voci[(voci.indexOf(document.activeElement) + passo + voci.length) % voci.length];
    event.preventDefault();
    prossima.focus();
    showView(prossima.dataset.view);
  }));
  elements.refreshButton.addEventListener("click", reload);
  // L'anno vale per la Dashboard: la lista movimenti ha il suo filtro
  const onYearChange = async (event) => {
    state.year = event.target.value ? Number(event.target.value) : null;
    try {
      await loadData();
    } catch (error) {
      showFeedback(`Errore nel caricamento: ${error.message}`, "error");
      return;
    }
    renderAll();
  };
  elements.yearSelects.forEach((select) => select.addEventListener("change", onYearChange));

  elements.sortButtons.forEach((button) => button.addEventListener("click", () => {
    cambiaOrdinamento(state.ordinamento, button.dataset.sort);
    loadMovimentiPage(true);
  }));
  elements.sortButtonsInv.forEach((button) => button.addEventListener("click", () => {
    cambiaOrdinamento(state.ordinamentoInv, button.dataset.sortInv);
    renderInvestimenti();
  }));
  elements.movimentiBody.addEventListener("keydown", (event) => {
    const riga = event.target.closest("tr.editing");
    if (!riga || !event.target.matches(".riga-input")) return;
    if (event.key === "Enter") salvaModifica(Number(riga.dataset.id));
    if (event.key === "Escape") annullaModifica();
  });

  document.querySelectorAll(".filtri-avanzate-pulsante").forEach((pulsante) => pulsante.addEventListener("click", () => {
    const id = pulsante.dataset.filtri;
    apriFiltriAvanzati(id, !document.getElementById(id).classList.contains("avanzate-aperte"));
  }));

  // Schede a tendina delle sintesi (solo telefono): in fase di cattura, prima dei link
  [elements.posizioniTable, elements.mercatoTable, elements.tipiTable].forEach((table) => table.addEventListener("click", apriChiudiScheda, true));

  // Estratto conto Fineco (Posizioni)
  elements.finecoButton.addEventListener("click", () => elements.finecoInput.click());
  elements.finecoInput.addEventListener("change", () => handleFinecoFile(elements.finecoInput.files[0]));
  elements.finecoPanel.addEventListener("click", (event) => {
    if (event.target.id === "fineco-confirm") confermaFineco();
    if (event.target.id === "fineco-cancel") {
      state.importFineco = null;
      renderFinecoPanel();
    }
  });
  elements.finecoPanel.addEventListener("change", (event) => {
    const imp = state.importFineco;
    const t = event.target;
    if (t.matches(".fineco-scelta")) {
      imp.scelte.set(t.dataset.nome, t.value === "nuova" ? "nuova" : t.value === "" ? undefined : Number(t.value));
      renderFinecoPanel(); // cambiano posizioni, rimborsi calcolati e righe "non trovate"
    }
    if (t.matches(".fineco-op")) {
      if (t.checked) imp.escluse.delete(Number(t.dataset.indice));
      else imp.escluse.add(Number(t.dataset.indice));
    }
    if (t.matches(".fineco-elimina")) {
      if (t.checked) imp.tenute.delete(Number(t.dataset.id));
      else imp.tenute.add(Number(t.dataset.id));
      renderFinecoPanel(); // il prezzo di carico delle vendite dipende dagli acquisti tenuti
    }
  });

  elements.excelButton.addEventListener("click", () => elements.excelInput.click());
  elements.excelInput.addEventListener("change", () => handleExcelFile(elements.excelInput.files[0]));
  elements.importPanel.addEventListener("input", (event) => {
    if (event.target.id === "import-saldo") controllaSaldoImport();
  });
  elements.importPanel.addEventListener("click", (event) => {
    if (event.target.id === "import-confirm") confermaImportazione();
    if (event.target.id === "import-cancel") {
      state.importazione = null;
      renderImportPanel();
    }
  });
  elements.mappaturaButton.addEventListener("click", () => {
    renderMappatura();
    elements.mappaturaPanel.classList.toggle("hidden");
  });
  elements.mappaturaPanel.addEventListener("click", handleMappaturaClick);
  elements.mappaturaPanel.addEventListener("change", handleMappaturaChange);

  elements.filterAnno.addEventListener("change", onFiltriChange);
  elements.filterMese.addEventListener("change", onFiltriChange);
  elements.filterCategoria.addEventListener("change", onFiltriChange);
  elements.filterTesto.addEventListener("input", onFiltriChange);
  elements.filterReset.addEventListener("click", () => {
    elements.filterAnno.value = "";
    elements.filterMese.value = "";
    elements.filterCategoria.value = "";
    elements.filterTesto.value = "";
    loadMovimentiPage(true);
  });

  elements.movimentiBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === "edit") startEdit(id);
    if (button.dataset.action === "delete") deleteMovimento(id);
    if (button.dataset.action === "categoria") apriSceltaCategoria(button, id);
    if (button.dataset.action === "save") salvaModifica(id);
    if (button.dataset.action === "cancel") annullaModifica();
  });

  elements.viewDashboard.addEventListener("click", (event) => {
    const gruppo = event.target.closest(".group-toggle");
    if (gruppo) return apriChiudiGruppo(gruppo);
    const target = event.target.closest(".clickable");
    if (target) openMovimentiFiltrati(target.dataset.anno, target.dataset.mese, target.dataset.categoria);
  });
  // Cursore degli interruttori: si riposiziona se cambia la larghezza delle voci
  window.addEventListener("resize", posizionaCursori);
  document.fonts?.ready.then(posizionaCursori);

  // Zoom dei grafici a linee: "Reimposta zoom" o doppio clic per tornare al grafico intero
  [elements.chartAndamento, elements.chartInvestimenti].forEach((canvas) => {
    canvas.parentElement.querySelector(".zoom-reset").addEventListener("click", (event) => {
      event.stopPropagation();
      reimpostaZoom(canvas);
    });
    canvas.addEventListener("dblclick", () => reimpostaZoom(canvas));
  });

  // Grafici a linee: primo piano sul telefono, riga dei valori che si chiude cliccando altrove
  [elements.chartAndamento, elements.chartInvestimenti].forEach((canvas) => {
    canvas.addEventListener("click", () => apriPrimoPiano(canvas.closest(".chart-box")));
  });
  document.querySelectorAll(".chiudi-primo-piano").forEach((button) => button.addEventListener("click", () => history.back()));
  window.addEventListener("popstate", chiudiPrimoPiano);

  elements.toggleButtons.forEach((button) => button.addEventListener("click", () => {
    state.tipoDashboard = button.dataset.tipo;
    // Nella tabella resta aperto solo il gruppo scelto (con la Sintesi nessuno)
    state.gruppiAperti = new Set(state.tipoDashboard === "sintesi" ? [] : [state.tipoDashboard]);
    renderDashboard();
  }));
  elements.viewDashboard.addEventListener("change", (event) => {
    if (event.target.matches(".budget-input")) saveBudget(event.target);
  });

  elements.invNuova.addEventListener("click", () => startEditInvestimento("nuova"));
  elements.aggiornaProposte.addEventListener("click", aggiornaProposte);
  elements.watchlistForm.addEventListener("submit", aggiungiAllaWatchlist);
  for (const [nome, campo] of [["importo", elements.proposteImporto], ["commissione", elements.proposteCommissione]]) {
    campo.addEventListener("change", () => {
      const valore = parseAmount(campo.value);
      if (valore === null || valore < 0) return showFeedback("Valore non valido.", "error");
      salvaImpostazione(nome, campo.value.trim());
      renderProposte();
    });
  }
  elements.proposteLista.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-azione]");
    if (!button) return;
    const isin = button.closest(".titolo-card").dataset.isin;
    if (button.dataset.azione === "rimuovi") rimuoviDallaWatchlist(isin);
    if (button.dataset.azione === "grafico") {
      state.graficoProposta = state.graficoProposta === isin ? null : isin;
      renderProposte();
    }
  });
  for (const [nome, campo] of Object.entries(elements.invFiltri)) {
    campo.addEventListener(nome === "testo" ? "input" : "change", () => {
      state.filtriInv[nome] = campo.value;
      renderInvestimenti();
    });
  }
  elements.invFiltroReset.addEventListener("click", () => openInvestimentiFiltrati({}));
  elements.viewDashboardInvestimenti.addEventListener("click", (event) => {
    const link = event.target.closest(".clickable[data-posizione], .clickable[data-tipo]");
    if (!link) return;
    openInvestimentiFiltrati(link.dataset.posizione !== undefined ? { posizione: link.dataset.posizione } : { tipo: link.dataset.tipo });
  });
  elements.invFuture.addEventListener("change", renderInvestimenti);
  elements.aggiornaPrezzi.forEach((b) => b.addEventListener("click", aggiornaPrezzi));
  elements.operazioniBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === "inv-edit") startEditInvestimento(id);
    if (button.dataset.action === "inv-delete") deleteInvestimento(id);
    if (button.dataset.action === "inv-save") salvaInvestimento();
    if (button.dataset.action === "inv-cancel") annullaInvestimento();
  });
  elements.operazioniBody.addEventListener("keydown", (event) => {
    if (!event.target.closest("tr.editing") || !event.target.matches(".riga-input")) return;
    if (event.key === "Enter") salvaInvestimento();
    if (event.key === "Escape") annullaInvestimento();
  });
  // Acquisto: scrivendo quantità o ABP l'importo proposto è quantità × ABP (resta modificabile;
  // per un singolo acquisto di una posizione con più acquisti va corretto col prezzo pagato)
  elements.operazioniBody.addEventListener("input", (event) => {
    const riga = event.target.closest("tr.editing");
    if (riga?.dataset.id === "nuova" && event.target.dataset.campo === "posizione") compilaDaPosizione(riga);
    // nome, ISIN, prodotto o tipo cambiati a mano: non sono più "compilati in automatico"
    if (riga && ["nome", "isin", "prodotto", "tipo"].includes(event.target.dataset.campo)) delete riga.dataset.autocompilata;
    if (!riga || !["quantita", "abp"].includes(event.target.dataset.campo)) return;
    if (riga.querySelector('[data-campo="operazione"]').value !== "Investimento") return;
    const quantita = parseAmount(riga.querySelector('[data-campo="quantita"]').value);
    const abp = parseAmount(riga.querySelector('[data-campo="abp"]').value);
    if (!(quantita > 0) || !(abp > 0)) return;
    riga.querySelector('[data-campo="importo"]').value = String(round2(quantita * abp)).replace(".", ",");
  });
  elements.operazioniBody.addEventListener("change", (event) => {
    const riga = event.target.closest("tr.editing");
    if (!riga) return;
    if (event.target.dataset.campo === "nome" && riga.dataset.id === "nuova") compilaDaNome(riga);
    if (event.target.dataset.campo === "domani") {
      const data = riga.querySelector('[data-campo="data"]');
      data.disabled = event.target.checked;
      if (event.target.checked) data.value = tomorrowISO();
    }
  });
}

async function init() {
  try {
    state.supabase = createSupabaseClient();
  } catch (error) {
    console.error(error);
    showFeedback(`Impossibile collegarsi al database: ${error.message}`, "error");
    return;
  }
  bindEvents();
  // Riapre l'ultima sezione vista (prima di caricare i dati, così i grafici si disegnano già visibili)
  let ultimaVista = "dashboard";
  try {
    ultimaVista = localStorage.getItem("myfinance:view") || ultimaVista;
  } catch {
    // Memoria del browser non disponibile: si parte dalla Dashboard
  }
  if (!elements.tabs.some((tab) => tab.dataset.view === ultimaVista)) ultimaVista = "dashboard";
  renderTabs(ultimaVista);
  showSection(ultimaVista);
  await reload();
}

init();

// Service worker (come in Listino Prezzi): permette di installare il sito come app da Chrome
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch((error) => {
    console.warn("Registrazione service worker fallita:", error);
  });
}
