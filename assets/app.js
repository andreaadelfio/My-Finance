const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const PAGE_SIZE = 1000;
const LISTA_PAGINA = 100; // movimenti caricati a ogni scorrimento

const state = {
  supabase: null,
  year: undefined, // anno della Dashboard; null = tutti gli anni
  tipoDashboard: "uscita", // la Dashboard mostra le uscite o le entrate
  years: [],
  categorie: [],
  aggregati: [], // somme per anno, mese e categoria calcolate dal database
  budget: [],
  saldi: new Map(), // anno -> saldo del conto a inizio anno
  mappatura: [], // categoria della banca -> mia categoria
  importazione: null, // anteprima del file Excel in corso di importazione
  investimenti: [],
  // Lista Movimenti: tutti gli anni, caricata a pagine mentre si scorre
  lista: { righe: [], finita: false, caricamento: false, richiesta: 0 },
  filtroTimeoutId: null,
  editingId: null,
  editingInvestimentoId: null,
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
  titoloGraficoLinee: document.querySelector("#titolo-grafico-linee"),
  titoloGraficoCategorie: document.querySelector("#titolo-grafico-categorie"),
  titoloCategorie: document.querySelector("#titolo-categorie"),
  saldoField: document.querySelector("#saldo-field"),
  titoloPeriodo: document.querySelector(".titolo-periodo"),
  viewInvestimenti: document.querySelector("#view-investimenti"),
  viewDashboardInvestimenti: document.querySelector("#view-dashboard-investimenti"),
  chartAndamento: document.querySelector("#chart-andamento"),
  chartCategorie: document.querySelector("#chart-categorie"),
  form: document.querySelector("#movimento-form"),
  formData: document.querySelector("#f-data"),
  formTipo: document.querySelector("#f-tipo"),
  formOperazione: document.querySelector("#f-operazione"),
  formCategoria: document.querySelector("#f-categoria"),
  formImporto: document.querySelector("#f-importo"),
  formNote: document.querySelector("#f-note"),
  formSubmit: document.querySelector("#f-submit"),
  formCancel: document.querySelector("#f-cancel"),
  operazioniList: document.querySelector("#operazioni-list"),
  filterAnno: document.querySelector("#filter-anno"),
  filterMese: document.querySelector("#filter-mese"),
  filterCategoria: document.querySelector("#filter-categoria"),
  filterTesto: document.querySelector("#filter-testo"),
  totali: document.querySelector("#totali"),
  movimentiBody: document.querySelector("#movimenti-body"),
  excelButton: document.querySelector("#excel-button"),
  excelInput: document.querySelector("#excel-input"),
  importPanel: document.querySelector("#import-panel"),
  mappaturaButton: document.querySelector("#mappatura-button"),
  mappaturaPanel: document.querySelector("#mappatura-panel"),
  listaFine: document.querySelector("#lista-fine"),
  saldoInput: document.querySelector("#saldo-input"),
  budgetHint: document.querySelector("#budget-hint"),
  andamentoTable: document.querySelector("#andamento-table"),
  categorieTable: document.querySelector("#categorie-table"),

  invForm: document.querySelector("#investimento-form"),
  invData: document.querySelector("#i-data"),
  invNome: document.querySelector("#i-nome"),
  invPosizione: document.querySelector("#i-posizione"),
  invIsin: document.querySelector("#i-isin"),
  invProdotto: document.querySelector("#i-prodotto"),
  invTipo: document.querySelector("#i-tipo"),
  invOperazione: document.querySelector("#i-operazione"),
  invQuantita: document.querySelector("#i-quantita"),
  invImporto: document.querySelector("#i-importo"),
  invCommissioni: document.querySelector("#i-commissioni"),
  invTassa: document.querySelector("#i-tassa"),
  invNote: document.querySelector("#i-note"),
  invSubmit: document.querySelector("#i-submit"),
  invCancel: document.querySelector("#i-cancel"),
  invFuture: document.querySelector("#i-future"),
  investimentiList: document.querySelector("#investimenti-list"),
  tipiList: document.querySelector("#tipi-list"),
  posizioniTable: document.querySelector("#posizioni-table"),
  tipiTable: document.querySelector("#tipi-table"),
  operazioniBody: document.querySelector("#operazioni-body"),
  investimentiSintesi: document.querySelector("#investimenti-sintesi"),
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

function tipoMovimento(movimento) {
  return categoriaById(movimento.categoria_id)?.tipo || (movimento.importo < 0 ? "uscita" : "entrata");
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
  const [categorie, aggregati, budget, saldi, investimenti, mappatura] = await Promise.all([
    fetchAll(() => state.supabase.from("categorie").select("*").order("id")),
    fetchAll(aggregatiQuery),
    fetchAll(() => state.supabase.from("budget").select("*").order("id")),
    fetchAll(() => state.supabase.from("saldi").select("*").order("anno")),
    fetchAll(() => state.supabase.from("investimenti").select("*").order("data").order("id")),
    fetchAll(() => state.supabase.from("mappatura_categorie").select("*").order("categoria_banca"))
  ]);

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
  state.investimenti = investimenti.map((riga) => ({
    ...riga,
    importo: Number(riga.importo),
    quantita: riga.quantita === null ? null : Number(riga.quantita)
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

function renderFormCategories(selectedId = "") {
  elements.formCategoria.innerHTML = `
    <option value="">Categoria...</option>
    ${categoryOptions(elements.formTipo.value)}
    <option value="nuova">+ Nuova categoria...</option>`;
  elements.formCategoria.value = selectedId ? String(selectedId) : "";
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

function renderOperazioniList() {
  const operazioni = [...new Set(state.lista.righe.map((movimento) => movimento.operazione).filter(Boolean))];
  elements.operazioniList.innerHTML = operazioni
    .sort((a, b) => a.localeCompare(b, "it"))
    .map((operazione) => `<option value="${escapeHtml(operazione)}"></option>`)
    .join("");
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
  if (testo) query = query.or(`operazione.ilike.*${testo}*,dettagli.ilike.*${testo}*,note.ilike.*${testo}*`);
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
  const { data, error } = await applyFilters(state.supabase.from("movimenti").select("*"))
    .order("data", { ascending: false })
    .order("id", { ascending: false })
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
  renderOperazioniList();
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
    elements.movimentiBody.innerHTML = lista.righe.map((movimento) => `
    <tr class="${movimento.id === state.editingId ? "editing" : ""}">
      <td data-label="Data">${formatDate(movimento.data)}</td>
      <td data-label="Operazione">
        <span class="operazione">${escapeHtml(movimento.operazione)}</span>
        ${movimento.dettagli ? `<span class="dettagli" title="${escapeHtml(movimento.dettagli)}">${escapeHtml(movimento.dettagli)}</span>` : ""}
      </td>
      <td data-label="Categoria">${escapeHtml(categoriaById(movimento.categoria_id)?.nome || "—")}</td>
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
    </tr>`).join("");
  }
  elements.listaFine.textContent = !lista.righe.length ? ""
    : lista.finita ? `Fine: ${lista.righe.length} movimenti mostrati.` : "Caricamento di altri movimenti...";
  if (!lista.finita) watchListaFine();
}

function onFiltriChange() {
  clearTimeout(state.filtroTimeoutId);
  state.filtroTimeoutId = setTimeout(() => loadMovimentiPage(true), 300);
}

function resetForm() {
  state.editingId = null;
  elements.form.reset();
  elements.formData.value = todayISO();
  renderFormCategories();
  elements.formSubmit.textContent = "Aggiungi";
  elements.formCancel.classList.add("hidden");
}

function startEdit(id) {
  const movimento = state.lista.righe.find((m) => m.id === id);
  if (!movimento) return;
  state.editingId = id;
  elements.formData.value = movimento.data;
  elements.formTipo.value = tipoMovimento(movimento);
  renderFormCategories(movimento.categoria_id || "");
  elements.formOperazione.value = movimento.operazione;
  elements.formImporto.value = String(Math.abs(movimento.importo)).replace(".", ",");
  elements.formNote.value = movimento.note || "";
  elements.formSubmit.textContent = "Salva";
  elements.formCancel.classList.remove("hidden");
  elements.form.scrollIntoView({ behavior: "smooth", block: "center" });
  elements.formOperazione.focus();
  renderMovimenti();
}

// Suggerisce tipo e categoria usati l'ultima volta per la stessa operazione
async function suggestCategory() {
  const operazione = elements.formOperazione.value.trim();
  if (elements.formCategoria.value || !operazione) return;
  const { data } = await state.supabase
    .from("movimenti")
    .select("categoria_id")
    .ilike("operazione", operazione.replace(/[%_\\]/g, "\\$&"))
    .not("categoria_id", "is", null)
    .order("data", { ascending: false })
    .limit(1);
  const categoria = data?.length ? categoriaById(data[0].categoria_id) : null;
  if (!categoria || elements.formCategoria.value) return;
  elements.formTipo.value = categoria.tipo;
  renderFormCategories(categoria.id);
}

async function createCategory() {
  const tipo = elements.formTipo.value;
  const nome = (prompt(`Nome della nuova categoria di ${tipo}:`) || "").trim();
  if (!nome) {
    renderFormCategories();
    return;
  }
  const esistente = categorieDelTipo(tipo, true).find((categoria) => normalize(categoria.nome) === normalize(nome));
  if (esistente) {
    renderFormCategories(esistente.id);
    return;
  }
  const { data, error } = await state.supabase.from("categorie").insert({ nome, tipo }).select().single();
  if (error) {
    showFeedback(`Categoria non creata: ${error.message}`, "error");
    renderFormCategories();
    return;
  }
  state.categorie.push(data);
  renderFormCategories(data.id);
  renderFilters();
}

async function handleSubmit(event) {
  event.preventDefault();
  const importo = parseAmount(elements.formImporto.value);
  if (importo === null || importo === 0) {
    showFeedback("Importo non valido.", "error");
    return;
  }
  const categoriaId = Number(elements.formCategoria.value);
  if (!categoriaId) {
    showFeedback("Scegli una categoria.", "error");
    return;
  }
  const record = {
    data: elements.formData.value,
    operazione: elements.formOperazione.value.trim(),
    categoria_id: categoriaId,
    importo: elements.formTipo.value === "uscita" ? -Math.abs(importo) : Math.abs(importo),
    note: elements.formNote.value.trim() || null
  };

  elements.formSubmit.disabled = true;
  const query = state.editingId
    ? state.supabase.from("movimenti").update(record).eq("id", state.editingId)
    : state.supabase.from("movimenti").insert(record);
  const { error } = await query;
  elements.formSubmit.disabled = false;
  if (error) {
    showFeedback(`Salvataggio non riuscito: ${error.message}`, "error");
    return;
  }

  showFeedback(state.editingId ? "Movimento aggiornato." : "Movimento aggiunto.");
  resetForm();
  await reload();
}

async function deleteMovimento(id) {
  const movimento = state.lista.righe.find((m) => m.id === id);
  if (!movimento || !confirm(`Eliminare "${movimento.operazione}" del ${formatDate(movimento.data)}?`)) return;
  const { error } = await state.supabase.from("movimenti").delete().eq("id", id);
  if (error) {
    showFeedback(`Eliminazione non riuscita: ${error.message}`, "error");
    return;
  }
  if (state.editingId === id) resetForm();
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
    return MESI.map((nome, i) => ({ key: `${state.year}-${i + 1}`, label: perGrafico ? `${nome} ${state.year}` : nome, anno: state.year, mese: i + 1 }));
  }
  const anni = [...new Set(state.aggregati.map((r) => r.anno))].sort((a, b) => a - b);
  if (!perGrafico) return anni.map((anno) => ({ key: String(anno), label: String(anno), anno, mese: null }));
  const lista = [];
  for (const anno of anni) {
    const mesi = state.aggregati.filter((r) => r.anno === anno).map((r) => r.mese);
    const ultimo = anno === anni[anni.length - 1] ? Math.max(...mesi) : 12;
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
function budgetYear(anno = state.year) {
  const anni = state.budget.map((riga) => riga.anno).filter((a) => a <= anno);
  return anni.length ? Math.max(...anni) : null;
}

function budgetFor(categoriaId, anno = state.year) {
  const annoBudget = budgetYear(anno);
  const riga = state.budget.find((r) => r.categoria_id === categoriaId && r.anno === annoBudget);
  if (riga) return riga.importo_mensile;
  // Anni in cui la categoria non era ancora nel budget: vale il primo budget successivo
  const successivo = state.budget
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

function renderAndamento() {
  const elenco = periodi(false);
  const { entrate, uscite, risparmio, saldi } = andamento(elenco);
  const media = tuttiGliAnni() ? "Media annua" : "Media mensile";
  const sum = (valori) => valori.reduce((total, v) => total + v, 0);
  const row = (label, valori, className = "") => `
    <tr class="${className}">
      <th>${label}</th>
      ${valori.map((v) => cell(v, v < 0 ? "negative" : "")).join("")}
      ${cell(sum(valori), sum(valori) < 0 ? "negative" : "")}
      ${cell(mediaMesiAttivi(valori))}
    </tr>`;
  const nessunSaldo = saldi.every((v) => v === null);

  elements.andamentoTable.innerHTML = !elenco.length ? '<tbody><tr><td class="empty">Nessun dato.</td></tr></tbody>' : `
    ${periodHeader("", elenco, [tuttiGliAnni() ? "Totale" : "Totale anno", media])}
    <tbody>
      ${row("Entrate", entrate)}
      ${row("Uscite", uscite)}
      ${row("Risparmio", risparmio, "strong-row")}
      <tr>
        <th>Saldo conto${tuttiGliAnni() ? " (fine anno)" : ""}</th>
        ${saldi.map((v) => (v === null ? '<td class="num"><span class="zero">—</span></td>' : cell(v))).join("")}
        <td class="num" colspan="2">${nessunSaldo ? '<span class="zero">imposta il saldo iniziale</span>' : ""}</td>
      </tr>
    </tbody>`;
}

function renderCategoryTable(table, tipo) {
  const elenco = periodi(false);
  const rows = totalsByCategory(tipo, elenco);
  // Budget modificabile solo per un singolo anno
  const withBudget = tipo === "uscita" && !tuttiGliAnni();
  const conBudget = tipo === "uscita";
  const categorie = categorieDelTipo(tipo, true).filter((c) => rows.has(c.id));
  const lines = categorie.map((c) => ({ id: c.id, nome: c.nome, ...rows.get(c.id) }));
  if (rows.has("nessuna")) lines.push({ id: "nessuna", nome: "Senza categoria", ...rows.get("nessuna") });

  if (!lines.length) {
    table.innerHTML = '<tbody><tr><td class="empty">Nessun dato.</td></tr></tbody>';
    return;
  }

  const totali = Array(elenco.length).fill(0);
  let budgetTotale = 0;
  const body = lines.map((line) => {
    const budget = line.id === "nessuna" ? null : budgetFor(line.id);
    if (budget) budgetTotale += budget;
    const celle = line.valori.map((valore, i) => {
      totali[i] += valore;
      const p = elenco[i];
      // Con tutti gli anni il confronto è con il budget annuale (12 mesi)
      const mensile = conBudget && line.id !== "nessuna" ? budgetFor(line.id, p.anno) : null;
      const limite = mensile === null ? null : p.mese === null ? mensile * 12 : mensile;
      const over = limite !== null && valore > limite;
      const link = valore ? `data-anno="${p.anno}" data-mese="${p.mese === null ? "" : p.mese - 1}" data-categoria="${line.id}"` : "";
      return `<td class="num ${over ? "over" : ""} ${valore ? "clickable" : ""}" ${link} ${over ? `title="Oltre il budget di ${formatEuro(valore - limite)}"` : ""}>${valore ? formatNumber(valore) : '<span class="zero">—</span>'}</td>`;
    }).join("");
    const totale = line.valori.reduce((s, v) => s + v, 0);
    const budgetCell = !withBudget ? "" : line.id === "nessuna"
      ? "<td></td>"
      : `<td class="num"><input class="budget-input" data-categoria="${line.id}" type="text" inputmode="decimal" value="${budget === null ? "" : String(budget).replace(".", ",")}" aria-label="Budget mensile ${escapeHtml(line.nome)}"></td>`;
    return `
      <tr>
        <th class="clickable" data-anno="${state.year ?? ""}" data-mese="" data-categoria="${line.id}">${escapeHtml(line.nome)}</th>
        ${celle}
        ${cell(totale, "strong")}
        ${cell(mediaMesiAttivi(line.valori))}
        ${budgetCell}
        <td class="num">${line.operazioni || ""}</td>
      </tr>`;
  }).join("");

  const totaleAnno = totali.reduce((s, v) => s + v, 0);
  table.innerHTML = `
    ${periodHeader("Categoria", elenco, ["Totale", "Media", ...(withBudget ? ["Budget"] : []), "Op."])}
    <tbody>${body}</tbody>
    <tfoot>
      <tr>
        <th>Totale</th>
        ${totali.map((v) => cell(v)).join("")}
        ${cell(totaleAnno)}
        ${cell(mediaMesiAttivi(totali))}
        ${withBudget ? cell(budgetTotale) : ""}
        <td class="num">${lines.reduce((s, l) => s + l.operazioni, 0)}</td>
      </tr>
    </tfoot>`;
}

function renderDashboard() {
  const uscite = state.tipoDashboard === "uscita";
  elements.toggleButtons.forEach((button) => button.classList.toggle("active", button.dataset.tipo === state.tipoDashboard));
  elements.titoloGraficoLinee.textContent = uscite
    ? "Uscite, entrate, risparmio e saldo mensili"
    : "Entrate per categoria nel tempo";
  elements.titoloGraficoCategorie.textContent = uscite
    ? "Categorie per spesa (interno) e per n° operazioni (esterno)"
    : "Totale per categoria";
  elements.titoloCategorie.textContent = uscite ? "Uscite per categoria" : "Entrate per categoria";
  const anno = budgetYear();
  elements.budgetHint.textContent = !uscite ? "" : tuttiGliAnni()
    ? "Con tutti gli anni le celle rosse superano il budget annuale (12 mesi); il budget si modifica scegliendo un anno."
    : anno !== null && anno !== state.year
      ? `Budget mensili del ${anno} (non ci sono ancora budget per il ${state.year}: modificandone uno si copiano tutti nel ${state.year}).`
      : "Budget mensili: le celle rosse lo superano.";
  elements.saldoField.classList.toggle("hidden", tuttiGliAnni());
  const saldo = state.saldi.get(state.year);
  elements.saldoInput.value = saldo === undefined ? "" : String(saldo).replace(".", ",");
  elements.titoloPeriodo.textContent = tuttiGliAnni() ? "Andamento annuale" : "Andamento mensile";
  renderAndamento();
  renderCategoryTable(elements.categorieTable, state.tipoDashboard);
  if (uscite) renderCharts();
  else renderEntrateCharts();
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

function drawChart(key, canvas, config) {
  if (!window.Chart) return;
  state.charts[key]?.destroy();
  state.charts[key] = new window.Chart(canvas, config);
}

const euroTooltip = { callbacks: { label: (item) => `${item.dataset.label}: ${formatEuro(item.raw)}` } };
const euroAxis = { y: { ticks: { callback: (value) => formatEuro(value) } } };

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

function renderCharts() {
  const elenco = periodi(true);
  const { entrate, uscite, risparmio, saldi } = andamento(elenco);
  drawChart("andamento", elements.chartAndamento, {
    type: "line",
    data: {
      labels: elenco.map((p) => p.label),
      datasets: [
        { label: "Totale Uscite", data: uscite, borderColor: "#4472c4", backgroundColor: "#4472c4" },
        { label: "Totale Entrate", data: entrate, borderColor: "#ed7d31", backgroundColor: "#ed7d31" },
        { label: "Risparmio", data: risparmio, borderColor: "#a5a5a5", backgroundColor: "#a5a5a5" },
        { label: "Saldo", data: saldi, borderColor: "#ffc000", backgroundColor: "#ffc000" }
      ]
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: tuttiGliAnni() ? 0 : 3 } },
      plugins: { legend: { position: "bottom" }, tooltip: euroTooltip },
      scales: euroAxis
    }
  });

  const categorie = totaliCategorie("uscita");
  const colori = categorie.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
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
        legend: { position: window.innerWidth < 720 ? "bottom" : "right", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: percentTooltip((item) => (item.dataset.label === "Spesa" ? formatEuro(item.raw) : `${item.raw} operazioni`))
      }
    },
    plugins: [percentLabels]
  });
}

function renderEntrateCharts() {
  const categorie = totaliCategorie("entrata");
  const colori = categorie.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  drawChart("categorie", elements.chartCategorie, {
    type: "pie",
    data: {
      labels: categorie.map((c) => c.nome),
      datasets: [{ label: "Totale", data: categorie.map((c) => Math.max(0, c.totale)), backgroundColor: colori }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: window.innerWidth < 720 ? "bottom" : "right" },
        tooltip: percentTooltip((item) => formatEuro(item.raw))
      }
    },
    plugins: [percentLabels]
  });

  const elenco = periodi(true);
  const perCategoria = totalsByCategory("entrata", elenco);
  drawChart("andamento", elements.chartAndamento, {
    type: "line",
    data: {
      labels: elenco.map((p) => p.label),
      datasets: categorie.map((c, i) => ({
        label: c.nome,
        data: perCategoria.get(c.id)?.valori || [],
        borderColor: colori[i],
        backgroundColor: colori[i]
      }))
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: tuttiGliAnni() ? 0 : 3 } },
      plugins: { legend: { position: "bottom" }, tooltip: euroTooltip },
      scales: euroAxis
    }
  });
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

async function saveSaldo() {
  const text = elements.saldoInput.value.trim();
  const saldo = parseAmount(text);
  if (text && saldo === null) return showFeedback("Saldo non valido.", "error");
  const { error } = text
    ? await state.supabase.from("saldi").upsert({ anno: state.year, saldo_iniziale: saldo })
    : await state.supabase.from("saldi").delete().eq("anno", state.year);
  if (error) return showFeedback(`Saldo non salvato: ${error.message}`, "error");
  showFeedback("Saldo iniziale salvato.");
  await reload();
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

function percent(value) {
  return value === null ? "" : `${value.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
}

function renderInvestimenti() {
  const righe = investimentiVisibili();
  const posizioni = riepilogoPosizioni(righe);

  elements.posizioniTable.innerHTML = !posizioni.length
    ? '<tbody><tr><td class="empty">Nessun investimento.</td></tr></tbody>'
    : `
    <thead><tr>
      <th>Nome</th><th class="num">ID</th><th>Tipo</th><th class="num">Capitale impegnato</th><th class="num">Rimborsi</th>
      <th class="num">Interessi</th><th class="num">Capitale maturato</th><th class="num">Risultato</th>
      <th class="num">Rend. %</th><th class="num">Durata (anni)</th><th class="num">Rend. % annuo</th>
    </tr></thead>
    <tbody>${posizioni.map((p) => `
      <tr>
        <th>${escapeHtml(p.nome)}</th>
        <td class="num">${p.posizione}</td>
        <td>${escapeHtml(p.tipo)}</td>
        ${cell(p.impegnato)}${cell(p.rimborsi)}${cell(p.interessi)}${cell(p.maturato)}
        ${cell(p.risultato, p.risultato < 0 ? "negative" : "positive")}
        <td class="num ${p.rendimento < 0 ? "negative" : ""}">${percent(p.rendimento)}</td>
        <td class="num">${p.durata.toLocaleString("it-IT", { maximumFractionDigits: 2 })}</td>
        <td class="num">${percent(p.annuo)}</td>
      </tr>`).join("")}</tbody>`;

  const tipi = new Map();
  for (const p of posizioni) {
    const t = tipi.get(p.tipo) || { impegnato: 0, maturato: 0 };
    t.impegnato += p.impegnato;
    t.maturato += p.maturato;
    tipi.set(p.tipo, t);
  }
  const totale = { impegnato: 0, maturato: 0 };
  const tipoRow = (nome, t, tag = "td") => {
    const risultato = t.maturato - t.impegnato;
    return `<tr><th>${escapeHtml(nome || "—")}</th>${cell(t.impegnato)}${cell(t.maturato)}
      ${cell(risultato, risultato < 0 ? "negative" : "positive")}
      <${tag} class="num">${percent(t.impegnato ? (risultato / t.impegnato) * 100 : 0)}</${tag}></tr>`;
  };
  const tipiRows = [...tipi.entries()].sort(([a], [b]) => a.localeCompare(b, "it")).map(([nome, t]) => {
    totale.impegnato += t.impegnato;
    totale.maturato += t.maturato;
    return tipoRow(nome, t);
  }).join("");
  elements.tipiTable.innerHTML = !tipi.size ? "" : `
    <thead><tr><th>Tipo</th><th class="num">Capitale impegnato</th><th class="num">Capitale maturato</th><th class="num">Risultato</th><th class="num">Rend. %</th></tr></thead>
    <tbody>${tipiRows}</tbody>
    <tfoot>${tipoRow("Totale", totale)}</tfoot>`;

  const oggi = todayISO();
  // Il registro mostra sempre tutte le operazioni, anche quelle future (in corsivo)
  elements.operazioniBody.innerHTML = [...state.investimenti].reverse().map((riga) => `
    <tr class="${riga.data > oggi ? "future" : ""} ${riga.id === state.editingInvestimentoId ? "editing" : ""}" ${riga.data > oggi ? 'title="Operazione prevista"' : ""}>
      <td>${formatDate(riga.data)}</td>
      <td class="num">${riga.posizione}</td>
      <td>${escapeHtml(riga.nome)}</td>
      <td>${escapeHtml(riga.tipo || "")}</td>
      <td>${escapeHtml(riga.operazione)}</td>
      <td class="num">${formatQuantity(riga.quantita)}</td>
      <td class="num ${riga.importo < 0 ? "negative" : "positive"}">${formatNumber(riga.importo)}</td>
      <td>${escapeHtml(riga.note || "")}</td>
      <td class="actions">
        <button class="icon-button" type="button" data-action="inv-edit" data-id="${riga.id}" title="Modifica" aria-label="Modifica">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button class="icon-button danger" type="button" data-action="inv-delete" data-id="${riga.id}" title="Elimina" aria-label="Elimina">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </td>
    </tr>`).join("") || '<tr><td colspan="9" class="empty">Nessuna operazione.</td></tr>';

  renderInvestimentiCharts(righe, tipi);

  const nomi = [...new Set(state.investimenti.map((r) => r.nome))].sort((a, b) => a.localeCompare(b, "it"));
  elements.investimentiList.innerHTML = nomi.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
  const tipiNomi = [...new Set(state.investimenti.map((r) => r.tipo).filter(Boolean))].sort();
  elements.tipiList.innerHTML = tipiNomi.map((t) => `<option value="${escapeHtml(t)}"></option>`).join("");
}

// Grafici come nel foglio: torta per tipo e andamento cumulato delle operazioni
function renderInvestimentiCharts(righe, tipi) {
  const oggi = todayISO();
  let investito = 0;
  let rimborsiCedole = 0;
  const punti = [];
  const sintesi = { investito: 0, restituito: 0, interessi: 0 };
  for (const riga of [...righe].sort((a, b) => a.data.localeCompare(b.data))) {
    if (riga.operazione === "Investimento") investito += riga.importo;
    else rimborsiCedole += riga.importo;
    punti.push({ data: riga.data, investito: round2(investito), rimborsiCedole: round2(rimborsiCedole) });
    if (riga.data <= oggi) {
      if (riga.operazione === "Investimento") sintesi.investito += -riga.importo;
      else if (riga.operazione === "Rimborso") sintesi.restituito += riga.importo;
      else sintesi.interessi += riga.importo;
    }
  }

  elements.investimentiSintesi.innerHTML = `Ad oggi (${formatDate(oggi)}):
    capitale investito <strong>${formatEuro(sintesi.investito)}</strong> ·
    capitale restituito <strong>${formatEuro(sintesi.restituito)}</strong> ·
    interessi e dividendi <strong class="positive">${formatEuro(sintesi.interessi)}</strong>`;

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
        legend: { position: "right" },
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

  drawChart("investimenti", elements.chartInvestimenti, {
    type: "line",
    data: {
      labels: punti.map((p) => formatDate(p.data)),
      datasets: [
        { label: "Capitale investito", data: punti.map((p) => p.investito), borderColor: "#4472c4", backgroundColor: "#4472c4" },
        { label: "Rimborsi + cedole", data: punti.map((p) => p.rimborsiCedole), borderColor: "#ed7d31", backgroundColor: "#ed7d31" },
        { label: "Capitale cumulato", data: punti.map((p) => round2(p.investito + p.rimborsiCedole)), borderColor: "#a5a5a5", backgroundColor: "#a5a5a5" }
      ]
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0 }, line: { stepped: true } },
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${formatEuro(item.raw)}` } }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 14 } },
        y: { ticks: { callback: (value) => formatEuro(value) } }
      }
    }
  });
}

function resetInvestimentoForm() {
  state.editingInvestimentoId = null;
  elements.invForm.reset();
  elements.invData.value = todayISO();
  elements.invSubmit.textContent = "Aggiungi";
  elements.invCancel.classList.add("hidden");
}

// Scegliendo un nome già usato, compila ID, ISIN, prodotto e tipo; un nome nuovo prende il prossimo ID
function fillInvestimentoFromNome() {
  if (state.editingInvestimentoId) return;
  const nome = normalize(elements.invNome.value);
  const precedenti = state.investimenti.filter((r) => normalize(r.nome) === nome);
  const ultimo = precedenti[precedenti.length - 1];
  if (ultimo) {
    elements.invPosizione.value = ultimo.posizione;
    elements.invIsin.value = ultimo.isin || "";
    elements.invProdotto.value = ultimo.prodotto || "";
    elements.invTipo.value = ultimo.tipo || "";
  } else if (!elements.invPosizione.value) {
    elements.invPosizione.value = Math.max(-1, ...state.investimenti.map((r) => r.posizione)) + 1;
  }
}

function startEditInvestimento(id) {
  const riga = state.investimenti.find((r) => r.id === id);
  if (!riga) return;
  state.editingInvestimentoId = id;
  const numero = (v) => (v === null || v === undefined ? "" : String(Math.abs(v)).replace(".", ","));
  elements.invData.value = riga.data;
  elements.invNome.value = riga.nome;
  elements.invPosizione.value = riga.posizione;
  elements.invIsin.value = riga.isin || "";
  elements.invProdotto.value = riga.prodotto || "";
  elements.invTipo.value = riga.tipo || "";
  elements.invOperazione.value = riga.operazione;
  elements.invQuantita.value = numero(riga.quantita);
  elements.invImporto.value = numero(riga.importo);
  elements.invCommissioni.value = numero(riga.commissioni);
  elements.invTassa.value = numero(riga.tassa);
  elements.invNote.value = riga.note || "";
  elements.invSubmit.textContent = "Salva";
  elements.invCancel.classList.remove("hidden");
  elements.invForm.scrollIntoView({ behavior: "smooth", block: "center" });
  renderInvestimenti();
}

async function handleInvestimentoSubmit(event) {
  event.preventDefault();
  const importo = parseAmount(elements.invImporto.value);
  if (importo === null || importo === 0) return showFeedback("Importo non valido.", "error");
  const opzionale = (input) => (input.value.trim() ? parseAmount(input.value) : null);
  const record = {
    data: elements.invData.value,
    posizione: Number(elements.invPosizione.value),
    nome: elements.invNome.value.trim(),
    isin: elements.invIsin.value.trim() || null,
    prodotto: elements.invProdotto.value.trim() || null,
    tipo: elements.invTipo.value.trim() || null,
    operazione: elements.invOperazione.value,
    quantita: opzionale(elements.invQuantita),
    // Come nell'Excel: l'investimento è un'uscita (negativo), il resto positivo
    importo: elements.invOperazione.value === "Investimento" ? -Math.abs(importo) : Math.abs(importo),
    commissioni: opzionale(elements.invCommissioni),
    tassa: opzionale(elements.invTassa),
    note: elements.invNote.value.trim() || null
  };
  elements.invSubmit.disabled = true;
  const { error } = state.editingInvestimentoId
    ? await state.supabase.from("investimenti").update(record).eq("id", state.editingInvestimentoId)
    : await state.supabase.from("investimenti").insert(record);
  elements.invSubmit.disabled = false;
  if (error) return showFeedback(`Salvataggio non riuscito: ${error.message}`, "error");
  showFeedback(state.editingInvestimentoId ? "Operazione aggiornata." : "Operazione aggiunta.");
  resetInvestimentoForm();
  await reload();
}

async function deleteInvestimento(id) {
  const riga = state.investimenti.find((r) => r.id === id);
  if (!riga || !confirm(`Eliminare "${riga.operazione} ${riga.nome}" del ${formatDate(riga.data)}?`)) return;
  const { error } = await state.supabase.from("investimenti").delete().eq("id", id);
  if (error) return showFeedback(`Eliminazione non riuscita: ${error.message}`, "error");
  if (state.editingInvestimentoId === id) resetInvestimentoForm();
  showFeedback("Operazione eliminata.");
  await reload();
}

// ---------------------------------------------------------------------------
// Navigazione ed eventi
// ---------------------------------------------------------------------------

function showView(view) {
  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  elements.viewMovimenti.classList.toggle("hidden", view !== "movimenti");
  elements.viewDashboard.classList.toggle("hidden", view !== "dashboard");
  elements.viewInvestimenti.classList.toggle("hidden", view !== "investimenti");
  elements.viewDashboardInvestimenti.classList.toggle("hidden", view !== "dashboard-investimenti");
  // I grafici disegnati mentre la sezione era nascosta vanno ridisegnati
  if (view === "dashboard") renderDashboard();
  if (view === "investimenti" || view === "dashboard-investimenti") renderInvestimenti();
  if (view === "movimenti" && !state.lista.finita) watchListaFine();
}

function renderAll() {
  renderYearSelect();
  renderFilters();
  renderOperazioniList();
  if (!state.editingId) renderFormCategories(elements.formCategoria.value);
  renderDashboard();
  renderInvestimenti();
}

// Click su un importo della dashboard: apre i movimenti filtrati per anno, mese e categoria
function openMovimentiFiltrati(anno, mese, categoria) {
  elements.filterAnno.value = anno ?? "";
  elements.filterMese.value = mese ?? "";
  elements.filterCategoria.value = categoria;
  elements.filterTesto.value = "";
  showView("movimenti");
  window.scrollTo(0, 0);
  loadMovimentiPage(true);
}

function bindEvents() {
  elements.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
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

  elements.form.addEventListener("submit", handleSubmit);
  elements.formCancel.addEventListener("click", () => {
    resetForm();
    renderMovimenti();
  });
  elements.formTipo.addEventListener("change", () => renderFormCategories());
  elements.formOperazione.addEventListener("change", suggestCategory);
  elements.formCategoria.addEventListener("change", () => {
    if (elements.formCategoria.value === "nuova") createCategory();
  });

  elements.excelButton.addEventListener("click", () => elements.excelInput.click());
  elements.excelInput.addEventListener("change", () => handleExcelFile(elements.excelInput.files[0]));
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

  elements.movimentiBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === "edit") startEdit(id);
    if (button.dataset.action === "delete") deleteMovimento(id);
  });

  elements.viewDashboard.addEventListener("click", (event) => {
    const target = event.target.closest(".clickable");
    if (target) openMovimentiFiltrati(target.dataset.anno, target.dataset.mese, target.dataset.categoria);
  });
  elements.toggleButtons.forEach((button) => button.addEventListener("click", () => {
    state.tipoDashboard = button.dataset.tipo;
    renderDashboard();
  }));
  elements.viewDashboard.addEventListener("change", (event) => {
    if (event.target.matches(".budget-input")) saveBudget(event.target);
  });
  elements.saldoInput.addEventListener("change", saveSaldo);

  elements.invForm.addEventListener("submit", handleInvestimentoSubmit);
  elements.invCancel.addEventListener("click", () => {
    resetInvestimentoForm();
    renderInvestimenti();
  });
  elements.invNome.addEventListener("change", fillInvestimentoFromNome);
  elements.invFuture.addEventListener("change", renderInvestimenti);
  elements.operazioniBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === "inv-edit") startEditInvestimento(id);
    if (button.dataset.action === "inv-delete") deleteInvestimento(id);
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
  resetForm();
  resetInvestimentoForm();
  await reload();
}

init();
