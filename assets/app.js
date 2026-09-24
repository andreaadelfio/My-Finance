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
  editingId: null,
  feedbackTimeoutId: null
};

const elements = {
  yearSelect: document.querySelector("#year-select"),
  tabs: [...document.querySelectorAll(".tab")],
  refreshButton: document.querySelector("#refresh-button"),
  feedback: document.querySelector("#feedback"),
  viewMovimenti: document.querySelector("#view-movimenti"),
  viewRiepilogo: document.querySelector("#view-riepilogo"),
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
  entrateTable: document.querySelector("#entrate-table")
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
  const [categorie, movimenti, budget, saldi] = await Promise.all([
    fetchAll(() => state.supabase.from("categorie").select("*").order("id")),
    fetchAll(() => state.supabase
      .from("movimenti")
      .select("*")
      .gte("data", `${year}-01-01`)
      .lte("data", `${year}-12-31`)
      .order("data", { ascending: false })
      .order("id", { ascending: false })),
    fetchAll(() => state.supabase.from("budget").select("*").lte("anno", year).order("id")),
    state.supabase.from("saldi").select("*").eq("anno", year)
  ]);
  if (saldi.error) throw saldi.error;

  state.categorie = categorie;
  state.movimenti = movimenti.map((movimento) => ({ ...movimento, importo: Number(movimento.importo) }));
  state.budget = budget.map((riga) => ({ ...riga, importo_mensile: Number(riga.importo_mensile) }));
  state.saldoIniziale = saldi.data.length ? Number(saldi.data[0].saldo_iniziale) : null;
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
  renderAndamento();
  renderCategoryTable(elements.usciteTable, "uscita");
  renderCategoryTable(elements.entrateTable, "entrata");
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
// Navigazione ed eventi
// ---------------------------------------------------------------------------

function showView(view) {
  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  elements.viewMovimenti.classList.toggle("hidden", view !== "movimenti");
  elements.viewRiepilogo.classList.toggle("hidden", view !== "riepilogo");
}

function renderAll() {
  renderYearSelect();
  renderFilters();
  renderOperazioniList();
  if (!state.editingId) renderFormCategories(elements.formCategoria.value);
  renderMovimenti();
  renderRiepilogo();
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
  await reload();
}

init();
