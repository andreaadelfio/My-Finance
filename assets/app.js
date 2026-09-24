const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const PAGE_SIZE = 1000;

const state = {
  supabase: null,
  year: new Date().getFullYear(),
  years: [],
  categorie: [],
  movimenti: [],
  budget: [],
  saldoIniziale: null,
  investimenti: [],
  editingId: null,
  editingInvestimentoId: null,
  charts: {},
  feedbackTimeoutId: null
};

const elements = {
  yearSelect: document.querySelector("#year-select"),
  tabs: [...document.querySelectorAll(".tab")],
  refreshButton: document.querySelector("#refresh-button"),
  feedback: document.querySelector("#feedback"),
  viewMovimenti: document.querySelector("#view-movimenti"),
  viewRiepilogo: document.querySelector("#view-riepilogo"),
  viewInvestimenti: document.querySelector("#view-investimenti"),
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
  filterMese: document.querySelector("#filter-mese"),
  filterCategoria: document.querySelector("#filter-categoria"),
  filterTesto: document.querySelector("#filter-testo"),
  totali: document.querySelector("#totali"),
  movimentiBody: document.querySelector("#movimenti-body"),
  saldoInput: document.querySelector("#saldo-input"),
  budgetHint: document.querySelector("#budget-hint"),
  andamentoTable: document.querySelector("#andamento-table"),
  usciteTable: document.querySelector("#uscite-table"),
  entrateTable: document.querySelector("#entrate-table"),
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

// Nelle tabelle del riepilogo gli importi sono senza "€" per stare in pagina
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

function monthIndex(movimento) {
  return Number(movimento.data.slice(5, 7)) - 1;
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

function categorieDelTipo(tipo) {
  return state.categorie
    .filter((categoria) => categoria.tipo === tipo)
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
  const year = state.year;
  const [categorie, movimenti, budget, saldi, investimenti] = await Promise.all([
    fetchAll(() => state.supabase.from("categorie").select("*").order("id")),
    fetchAll(() => state.supabase
      .from("movimenti")
      .select("*")
      .gte("data", `${year}-01-01`)
      .lte("data", `${year}-12-31`)
      .order("data", { ascending: false })
      .order("id", { ascending: false })),
    fetchAll(() => state.supabase.from("budget").select("*").lte("anno", year).order("id")),
    state.supabase.from("saldi").select("*").eq("anno", year),
    fetchAll(() => state.supabase.from("investimenti").select("*").order("data").order("id"))
  ]);
  if (saldi.error) throw saldi.error;

  state.categorie = categorie;
  state.movimenti = movimenti.map((movimento) => ({ ...movimento, importo: Number(movimento.importo) }));
  state.budget = budget.map((riga) => ({ ...riga, importo_mensile: Number(riga.importo_mensile) }));
  state.saldoIniziale = saldi.data.length ? Number(saldi.data[0].saldo_iniziale) : null;
  state.investimenti = investimenti.map((riga) => ({
    ...riga,
    importo: Number(riga.importo),
    quantita: riga.quantita === null ? null : Number(riga.quantita)
  }));
}

async function reload() {
  elements.movimentiBody.innerHTML = '<tr><td colspan="6" class="empty">Caricamento...</td></tr>';
  try {
    await loadYears();
    await loadData();
  } catch (error) {
    console.error(error);
    showFeedback(`Errore nel caricamento: ${error.message}`, "error");
    return;
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Movimenti
// ---------------------------------------------------------------------------

function renderYearSelect() {
  elements.yearSelect.innerHTML = state.years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  elements.yearSelect.value = String(state.year);
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
  const mese = elements.filterMese.value;
  const categoria = elements.filterCategoria.value;
  elements.filterMese.innerHTML = '<option value="">Tutti i mesi</option>'
    + MESI.map((nome, index) => `<option value="${index}">${nome}</option>`).join("");
  elements.filterCategoria.innerHTML = `
    <option value="">Tutte le categorie</option>
    <optgroup label="Uscite">${categoryOptions("uscita")}</optgroup>
    <optgroup label="Entrate">${categoryOptions("entrata")}</optgroup>
    <option value="nessuna">Senza categoria</option>`;
  elements.filterMese.value = mese;
  elements.filterCategoria.value = categoria;
}

function renderOperazioniList() {
  const operazioni = [...new Set(state.movimenti.map((movimento) => movimento.operazione).filter(Boolean))];
  elements.operazioniList.innerHTML = operazioni
    .sort((a, b) => a.localeCompare(b, "it"))
    .map((operazione) => `<option value="${escapeHtml(operazione)}"></option>`)
    .join("");
}

function getFilteredMovimenti() {
  const mese = elements.filterMese.value;
  const categoria = elements.filterCategoria.value;
  const testo = normalize(elements.filterTesto.value);
  return state.movimenti.filter((movimento) => {
    if (mese !== "" && monthIndex(movimento) !== Number(mese)) return false;
    if (categoria === "nessuna" && movimento.categoria_id) return false;
    if (categoria && categoria !== "nessuna" && movimento.categoria_id !== Number(categoria)) return false;
    if (testo && !normalize(`${movimento.operazione} ${movimento.dettagli} ${movimento.note || ""}`).includes(testo)) return false;
    return true;
  });
}

function renderMovimenti() {
  const movimenti = getFilteredMovimenti();
  const entrate = movimenti.filter((m) => m.importo > 0).reduce((sum, m) => sum + m.importo, 0);
  const uscite = movimenti.filter((m) => m.importo < 0).reduce((sum, m) => sum - m.importo, 0);
  elements.totali.innerHTML = `${movimenti.length} movimenti ·
    entrate <strong class="positive">${formatEuro(entrate)}</strong> ·
    uscite <strong class="negative">${formatEuro(uscite)}</strong> ·
    saldo <strong>${formatEuro(entrate - uscite)}</strong>`;

  if (!movimenti.length) {
    elements.movimentiBody.innerHTML = `<tr><td colspan="6" class="empty">Nessun movimento${state.movimenti.length ? " con questi filtri" : ` nel ${state.year}`}.</td></tr>`;
    return;
  }

  elements.movimentiBody.innerHTML = movimenti.map((movimento) => `
    <tr class="${movimento.id === state.editingId ? "editing" : ""}">
      <td data-label="Data">${formatDate(movimento.data)}</td>
      <td data-label="Operazione">
        <span class="operazione">${escapeHtml(movimento.operazione)}</span>
        ${movimento.dettagli ? `<span class="dettagli" title="${escapeHtml(movimento.dettagli)}">${escapeHtml(movimento.dettagli)}</span>` : ""}
      </td>
      <td data-label="Categoria">${escapeHtml(categoriaById(movimento.categoria_id)?.nome || "—")}</td>
      <td data-label="Importo" class="num ${movimento.importo < 0 ? "negative" : "positive"}">${formatEuro(movimento.importo)}</td>
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

function resetForm() {
  state.editingId = null;
  elements.form.reset();
  elements.formData.value = state.year === new Date().getFullYear() ? todayISO() : `${state.year}-01-01`;
  renderFormCategories();
  elements.formSubmit.textContent = "Aggiungi";
  elements.formCancel.classList.add("hidden");
}

function startEdit(id) {
  const movimento = state.movimenti.find((m) => m.id === id);
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
function suggestCategory() {
  if (elements.formCategoria.value) return;
  const operazione = normalize(elements.formOperazione.value);
  const precedente = state.movimenti.find((m) => m.categoria_id && normalize(m.operazione) === operazione);
  if (!precedente) return;
  elements.formTipo.value = tipoMovimento(precedente);
  renderFormCategories(precedente.categoria_id);
}

async function createCategory() {
  const tipo = elements.formTipo.value;
  const nome = (prompt(`Nome della nuova categoria di ${tipo}:`) || "").trim();
  if (!nome) {
    renderFormCategories();
    return;
  }
  const esistente = categorieDelTipo(tipo).find((categoria) => normalize(categoria.nome) === normalize(nome));
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

  const savedYear = Number(record.data.slice(0, 4));
  if (savedYear !== state.year) showFeedback(`Movimento salvato nel ${savedYear}.`);
  else showFeedback(state.editingId ? "Movimento aggiornato." : "Movimento aggiunto.");
  resetForm();
  await reload();
}

async function deleteMovimento(id) {
  const movimento = state.movimenti.find((m) => m.id === id);
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
// Riepilogo (come la "Dashboard Riassuntiva" dell'Excel)
// ---------------------------------------------------------------------------

// Anno dei budget in uso: quello selezionato o, se non ne ha, l'ultimo precedente
function budgetYear() {
  const anni = state.budget.map((riga) => riga.anno).filter((anno) => anno <= state.year);
  return anni.length ? Math.max(...anni) : null;
}

function budgetFor(categoriaId) {
  const anno = budgetYear();
  const riga = state.budget.find((r) => r.categoria_id === categoriaId && r.anno === anno);
  return riga ? riga.importo_mensile : null;
}

// Media sui soli mesi con importo, come AVERAGEIF(..., "<>0") nell'Excel
function mediaMesiAttivi(valori) {
  const attivi = valori.filter((valore) => valore !== 0);
  return attivi.length ? attivi.reduce((sum, v) => sum + v, 0) / attivi.length : 0;
}

function cell(value, extraClass = "") {
  return `<td class="num ${extraClass}">${value ? formatNumber(value) : '<span class="zero">—</span>'}</td>`;
}

function monthHeader(firstLabel, extra = []) {
  return `<thead><tr><th>${firstLabel}</th>${MESI.map((m) => `<th class="num">${m}</th>`).join("")}${extra.map((e) => `<th class="num">${e}</th>`).join("")}</tr></thead>`;
}

function totalsByCategory(tipo) {
  const rows = new Map();
  for (const movimento of state.movimenti) {
    if (tipoMovimento(movimento) !== tipo) continue;
    const key = movimento.categoria_id || "nessuna";
    if (!rows.has(key)) rows.set(key, { mesi: Array(12).fill(0), operazioni: 0 });
    const row = rows.get(key);
    row.mesi[monthIndex(movimento)] += tipo === "uscita" ? -movimento.importo : movimento.importo;
    row.operazioni += 1;
  }
  return rows;
}

function renderAndamento() {
  const entrate = Array(12).fill(0);
  const uscite = Array(12).fill(0);
  let ultimoMese = -1;
  for (const movimento of state.movimenti) {
    const mese = monthIndex(movimento);
    ultimoMese = Math.max(ultimoMese, mese);
    if (tipoMovimento(movimento) === "uscita") uscite[mese] -= movimento.importo;
    else entrate[mese] += movimento.importo;
  }
  const risparmio = entrate.map((valore, i) => round2(valore - uscite[i]));

  let saldo = state.saldoIniziale;
  const saldi = risparmio.map((valore, i) => {
    if (saldo === null || i > ultimoMese) return null;
    saldo = round2(saldo + valore);
    return saldo;
  });

  const sum = (valori) => valori.reduce((total, v) => total + v, 0);
  const row = (label, valori, className = "") => `
    <tr class="${className}">
      <th>${label}</th>
      ${valori.map((v) => cell(v, v < 0 ? "negative" : "")).join("")}
      ${cell(sum(valori), sum(valori) < 0 ? "negative" : "")}
      ${cell(mediaMesiAttivi(valori))}
    </tr>`;

  elements.andamentoTable.innerHTML = `
    ${monthHeader("", ["Totale anno", "Media mensile"])}
    <tbody>
      ${row("Entrate", entrate)}
      ${row("Uscite", uscite)}
      ${row("Risparmio", risparmio, "strong-row")}
      <tr>
        <th>Saldo conto</th>
        ${saldi.map((v) => (v === null ? '<td class="num"><span class="zero">—</span></td>' : cell(v))).join("")}
        <td class="num" colspan="2">${state.saldoIniziale === null ? '<span class="zero">imposta il saldo iniziale</span>' : ""}</td>
      </tr>
    </tbody>`;
  return { entrate, uscite, risparmio, saldi };
}

function renderCategoryTable(table, tipo) {
  const rows = totalsByCategory(tipo);
  const withBudget = tipo === "uscita";
  const categorie = categorieDelTipo(tipo).filter((c) => rows.has(c.id));
  const lines = categorie.map((c) => ({ id: c.id, nome: c.nome, ...(rows.get(c.id) || { mesi: Array(12).fill(0), operazioni: 0 }) }));
  if (rows.has("nessuna")) lines.push({ id: "nessuna", nome: "Senza categoria", ...rows.get("nessuna") });

  if (!lines.length) {
    table.innerHTML = '<tbody><tr><td class="empty">Nessun dato per quest\'anno.</td></tr></tbody>';
    return;
  }

  const totaliMese = Array(12).fill(0);
  let budgetTotale = 0;
  const body = lines.map((line) => {
    const budget = line.id === "nessuna" ? null : budgetFor(line.id);
    if (budget) budgetTotale += budget;
    const mesi = line.mesi.map((valore, i) => {
      totaliMese[i] += valore;
      const over = withBudget && budget !== null && valore > budget;
      const link = valore ? `data-mese="${i}" data-categoria="${line.id}"` : "";
      return `<td class="num ${over ? "over" : ""} ${valore ? "clickable" : ""}" ${link} ${over ? `title="Oltre il budget di ${formatEuro(valore - budget)}"` : ""}>${valore ? formatNumber(valore) : '<span class="zero">—</span>'}</td>`;
    }).join("");
    const totale = line.mesi.reduce((s, v) => s + v, 0);
    const budgetCell = !withBudget ? "" : line.id === "nessuna"
      ? "<td></td>"
      : `<td class="num"><input class="budget-input" data-categoria="${line.id}" type="text" inputmode="decimal" value="${budget === null ? "" : String(budget).replace(".", ",")}" aria-label="Budget mensile ${escapeHtml(line.nome)}"></td>`;
    return `
      <tr>
        <th class="clickable" data-categoria="${line.id}">${escapeHtml(line.nome)}</th>
        ${mesi}
        ${cell(totale, "strong")}
        ${cell(mediaMesiAttivi(line.mesi))}
        ${budgetCell}
        <td class="num">${line.operazioni || ""}</td>
      </tr>`;
  }).join("");

  const totaleAnno = totaliMese.reduce((s, v) => s + v, 0);
  table.innerHTML = `
    ${monthHeader("Categoria", ["Totale", "Media", ...(withBudget ? ["Budget"] : []), "Op."])}
    <tbody>${body}</tbody>
    <tfoot>
      <tr>
        <th>Totale</th>
        ${totaliMese.map((v) => cell(v)).join("")}
        ${cell(totaleAnno)}
        ${cell(mediaMesiAttivi(totaliMese))}
        ${withBudget ? cell(budgetTotale) : ""}
        <td class="num">${lines.reduce((s, l) => s + l.operazioni, 0)}</td>
      </tr>
    </tfoot>`;
}

function renderRiepilogo() {
  const anno = budgetYear();
  elements.budgetHint.textContent = anno !== null && anno !== state.year
    ? `Budget mensili del ${anno} (non ci sono ancora budget per il ${state.year}: modificandone uno si copiano tutti nel ${state.year}).`
    : "Budget mensili: le celle rosse lo superano.";
  elements.saldoInput.value = state.saldoIniziale === null ? "" : String(state.saldoIniziale).replace(".", ",");
  const andamento = renderAndamento();
  renderCategoryTable(elements.usciteTable, "uscita");
  renderCategoryTable(elements.entrateTable, "entrata");
  renderCharts(andamento);
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

function renderCharts({ entrate, uscite, risparmio, saldi }) {
  drawChart("andamento", elements.chartAndamento, {
    type: "line",
    data: {
      labels: MESI.map((mese) => `${mese} ${state.year}`),
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
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${formatEuro(item.raw)}` } }
      },
      scales: { y: { ticks: { callback: (value) => formatEuro(value) } } }
    }
  });

  const righe = totalsByCategory("uscita");
  const categorie = [...righe.entries()]
    .map(([id, riga]) => ({
      nome: id === "nessuna" ? "Senza categoria" : categoriaById(id)?.nome || "?",
      spesa: round2(riga.mesi.reduce((sum, v) => sum + v, 0)),
      operazioni: riga.operazioni
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  const colori = categorie.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  drawChart("categorie", elements.chartCategorie, {
    type: "doughnut",
    data: {
      labels: categorie.map((c) => c.nome),
      datasets: [
        { label: "N° operazioni", data: categorie.map((c) => c.operazioni), backgroundColor: colori },
        { label: "Spesa", data: categorie.map((c) => Math.max(0, c.spesa)), backgroundColor: colori }
      ]
    },
    options: {
      maintainAspectRatio: false,
      cutout: "35%",
      plugins: {
        legend: { position: window.innerWidth < 720 ? "bottom" : "right", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const total = item.dataset.data.reduce((sum, v) => sum + v, 0);
              const value = item.dataset.label === "Spesa" ? formatEuro(item.raw) : `${item.raw} operazioni`;
              return `${item.label}: ${value} (${Math.round((item.raw / total) * 100)}%)`;
            }
          }
        }
      }
    },
    plugins: [percentLabels]
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
  elements.operazioniBody.innerHTML = [...righe].reverse().map((riga) => `
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
  elements.viewRiepilogo.classList.toggle("hidden", view !== "riepilogo");
  elements.viewInvestimenti.classList.toggle("hidden", view !== "investimenti");
  // I grafici disegnati mentre la sezione era nascosta vanno ridisegnati
  if (view === "riepilogo") renderRiepilogo();
  if (view === "investimenti") renderInvestimenti();
}

function renderAll() {
  renderYearSelect();
  renderFilters();
  renderOperazioniList();
  if (!state.editingId) renderFormCategories(elements.formCategoria.value);
  renderMovimenti();
  renderRiepilogo();
  renderInvestimenti();
}

// Click su un importo del riepilogo: apre i movimenti filtrati
function openMovimentiFiltrati(mese, categoria) {
  elements.filterMese.value = mese ?? "";
  elements.filterCategoria.value = categoria;
  elements.filterTesto.value = "";
  renderMovimenti();
  showView("movimenti");
  window.scrollTo(0, 0);
}

function bindEvents() {
  elements.tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  elements.refreshButton.addEventListener("click", reload);
  elements.yearSelect.addEventListener("change", async () => {
    state.year = Number(elements.yearSelect.value);
    resetForm();
    await reload();
  });

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

  elements.filterMese.addEventListener("change", renderMovimenti);
  elements.filterCategoria.addEventListener("change", renderMovimenti);
  elements.filterTesto.addEventListener("input", renderMovimenti);

  elements.movimentiBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === "edit") startEdit(id);
    if (button.dataset.action === "delete") deleteMovimento(id);
  });

  elements.viewRiepilogo.addEventListener("click", (event) => {
    const target = event.target.closest(".clickable");
    if (target) openMovimentiFiltrati(target.dataset.mese, target.dataset.categoria);
  });
  elements.viewRiepilogo.addEventListener("change", (event) => {
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
