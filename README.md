# MyFinance

Piccola web app statica per le finanze personali, con i dati su Supabase.
Sostituisce il file Excel `Portafogli.xlsx` per movimenti, budget e riepilogo annuale.

## Struttura

- `index.html`: interfaccia (schede Dashboard, Movimenti, Dashboard investimenti, Investimenti).
- `assets/app.js`: tutta la logica del sito.
- `assets/styles.css`: stile.
- `assets/config.js`: URL e chiave publishable di Supabase.
- `supabase/schema.sql`: tabelle `categorie`, `movimenti`, `budget`, `saldi`, `investimenti`, `mappatura_categorie`.
- `import_excel.py`: carica su Supabase i dati dei file Excel.

## Cosa fa

- **Movimenti**: un'unica lista di tutti gli anni, dal più recente. Le righe si caricano
  100 alla volta mentre scorri la pagina. I filtri (anno, mese, categoria, ricerca) e i
  totali vengono calcolati dal database su tutti i movimenti, non solo su quelli caricati.
  Cliccando le intestazioni delle colonne si ordina la lista (secondo clic: ordine inverso),
  sempre su tutti i movimenti. I movimenti si aggiungono da Excel ("+ Excel"); la matita rende
  modificabili data, operazione, dettagli, importo (negativo per le uscite) e note della riga
  (Invio salva, Esc annulla). Cliccando la categoria di una riga si apre una tendina per
  cambiarla al volo.
  La colonna **Budget** mostra il budget mensile della categoria nell'anno del movimento (se in
  quell'anno la categoria non era ancora nel budget, vale il primo budget successivo): rossa se
  il movimento da solo lo supera, gialla ("nessuno") se la categoria non ha budget. Il filtro
  categoria "Uscite senza budget" le raccoglie tutte: di solito sono categorie della banca da
  aggiungere in Mappatura categorie.
- **Dashboard** (pagina iniziale): come la "Dashboard Riassuntiva" dell'Excel. Filtro anno
  (di default il più recente) oppure "Tutti gli anni". Con un anno: entrate, uscite,
  risparmio e saldo del conto mese per mese, uscite per categoria con totale, media dei
  mesi con spesa, budget mensile (modificabile nella tabella) e numero di operazioni.
  Con tutti gli anni le tabelle hanno una colonna per anno e i grafici coprono tutti i mesi.
  Le celle rosse superano il budget; cliccando un importo si aprono i movimenti corrispondenti.
  Il selettore **Uscite / Entrate** (di default Uscite) passa alla vista della "Dashboard Entrate":
  torta del totale per categoria, una linea per categoria nel tempo e tabella delle entrate.
- **Dashboard investimenti**: come "Investimenti Dashboard": sintesi, grafici, riepilogo per
  posizione e per tipo (con o senza le operazioni future già in calendario). Il grafico
  "Andamento nel tempo" ha l'asse per date e mostra, cumulati, capitale investito, rimborsi,
  cedole e dividendi e il saldo netto (rientrato − investito: sopra zero è guadagno).
- **Investimenti**: registro di tutte le operazioni (investimenti, rimborsi, cedole, dividendi)
  con il modulo per aggiungerle, modificarle ed eliminarle; colonne ordinabili. Di default va
  dal passato al futuro, con in verde l'ultima operazione già avvenuta.
  Le operazioni **"Sempre domani"** (colonna `domani` della tabella `investimenti`, come le
  date `=OGGI()+1` dell'Excel) sono il valore attuale di una posizione ancora aperta, come se
  la chiudessi domani: per il sito la loro data è sempre domani, qualunque data sia scritta
  nel database. Quando chiudi davvero la posizione, togli la spunta e metti la data vera.

Nei grafici dell'andamento (Dashboard e Dashboard investimenti) una linea tratteggiata
verticale segna la data di oggi.

Con "Tutti gli anni" la tabella **Andamento annuale** parte dal 2021, come il foglio "Pre 2023":
oltre a entrate, uscite, risparmio e saldo a fine anno mostra mesi lavorati ed entrate e uscite
al mese. Gli anni senza movimenti vengono dalla tabella `riepiloghi_annuali` (importata da
`Pre 2023.xlsx`), il saldo parte dai saldi a inizio anno. Nel grafico questi anni compaiono
sui mesi lavorati con la media mensile, a linea tratteggiata.

I totali della Dashboard sono sommati dal database (per anno, mese e categoria):
il sito non scarica tutti i movimenti.

## Primo avvio

1. Nel progetto Supabase apri **SQL Editor**, incolla `supabase/schema.sql` ed eseguilo.
2. In `assets/config.js` controlla URL e chiave publishable
   (Project Settings → API Keys).
3. Carica lo storico dagli Excel:

   ```bash
   pip install -r requirements.txt
   cd ~/Dropbox/Documenti/Finanza/Portafogli
   python3 ~/Dropbox/Progetti/Python/MyFinance/import_excel.py \
     "Storico/Portafogli 2023.xlsx" "Storico/Portafogli 2024.xlsx" \
     "Storico/Portafogli 2025.xlsx" Portafogli.xlsx "Storico/Pre 2023.xlsx"
   ```

   Con `--dry-run` legge i file e mostra i totali senza scrivere nulla.

## Aggiungere movimenti recenti

- Con il pulsante **+ Excel** in Movimenti: scegli l'estratto conto esportato dalla banca
  (serve una riga di intestazione con almeno "Data" e "Importo") oppure un file Portafogli.
  Il sito mostra un'anteprima: quanti movimenti sono nuovi e quanti già presenti (saltati),
  e l'elenco di quelli che verranno aggiunti. Per le categorie della banca senza
  corrispondenza scegli lì a quale tua categoria associarle (o di crearla); la scelta
  viene ricordata. Poi "Importa".
- Oppure dal terminale con `import_excel.py` sullo stesso file.

Un movimento è "già presente" se ha stessa data, importo, operazione e dettagli di uno
esistente: reimportare lo stesso file non crea doppioni. Attenzione alle righe scritte
a mano con una descrizione diversa da quella della banca: vengono aggiunte di nuovo.

### Mappatura categorie

La banca usa categorie proprie (es. "Trasporti, noleggi, taxi e parcheggi"); la tabella
`mappatura_categorie` le converte nelle tue (es. "Trasporti varie"). Si vede e si modifica
dal pulsante **Mappatura categorie** in Movimenti; la usano sia "+ Excel" sia
`import_excel.py`. Le categorie della banca con lo stesso nome di una tua non servono.

La mappatura la applica anche il database, con un trigger: un movimento la cui categoria
ha il nome di una categoria della banca mappata passa da solo alla categoria mappata, per
tutti gli anni. Vale per i movimenti nuovi (da qualunque parte arrivino) e, quando aggiungi
o cambi una voce della mappatura, anche per quelli già presenti. Le categorie della banca già
mappate non compaiono più nelle tendine.

Le categorie senza movimenti spariscono da sole: quando l'ultimo movimento di una categoria
viene eliminato o spostato, il database la cancella con i suoi budget. Prima di svuotare una
categoria della banca mappata, i suoi budget vengono copiati sulla categoria di destinazione
(per gli anni in cui questa non ne ha). Restano le categorie usate come destinazione di una
mappatura.

Categorie da rinominare o eliminare: dal Table Editor di Supabase (tabella `categorie`).
Nel Table Editor le tabelle `budget`, `movimenti` e `mappatura_categorie` hanno, accanto a
`categoria_id`, la colonna `categoria` con il nome. Si può anche scrivere direttamente il nome
(es. per aggiungere un budget): il database trova l'id, o dà errore se il nome non esiste.
Rinominando una categoria il nome si aggiorna ovunque.
Budget di un anno nuovo: al primo movimento dell'anno il database copia i budget dell'anno
precedente, che poi si adeguano (Table Editor o Dashboard). Ogni categoria di uscita, anche
nuova, ha la sua riga di `budget` nell'anno in corso (a 0 se non impostata), da compilare;
fanno eccezione le categorie della banca già mappate su un'altra. Per il sito un budget a 0
vale come "nessun budget" (giallo): per togliere il budget a una categoria mettilo a 0.

## Avvio locale

```bash
make dev    # http://127.0.0.1:8002/index.html
make stop
```

## Pubblicazione

Come Listino Prezzi: repository GitHub con GitHub Pages sul branch `main`, poi `make git`
per pubblicare le modifiche. Il `.gitignore` esclude i file Excel e CSV.

Nota: come Listino Prezzi il sito non ha login, quindi chiunque conosca l'indirizzo
può vedere e modificare i dati.
