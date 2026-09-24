# MyFinance

Piccola web app statica per le finanze personali, con i dati su Supabase.
Sostituisce il file Excel `Portafogli.xlsx` per movimenti, budget e riepilogo annuale.

## Struttura

- `index.html`: interfaccia (tab Movimenti e Riepilogo).
- `assets/app.js`: tutta la logica del sito.
- `assets/styles.css`: stile.
- `assets/config.js`: URL e chiave publishable di Supabase.
- `supabase/schema.sql`: tabelle `categorie`, `movimenti`, `budget`, `saldi`.
- `import_excel.py`: carica su Supabase i dati dei file Excel.

## Cosa fa

- **Movimenti**: elenco per anno con filtri (mese, categoria, ricerca) e totali;
  aggiungi, modifica ed elimina entrate e uscite. L'importo si scrive positivo:
  il segno lo decide il tipo (Uscita/Entrata). Scrivendo un'operazione già vista,
  la categoria viene proposta in automatico.
- **Riepilogo**: come la "Dashboard Riassuntiva" dell'Excel. Entrate, uscite,
  risparmio e saldo del conto mese per mese; uscite ed entrate per categoria con
  totale, media dei mesi con spesa, budget mensile (modificabile nella tabella) e
  numero di operazioni. Le celle rosse superano il budget; cliccando un importo
  si aprono i movimenti corrispondenti.

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
     "Storico/Portafogli 2025.xlsx" Portafogli.xlsx
   ```

   Con `--dry-run` legge i file e mostra i totali senza scrivere nulla.

## Aggiungere movimenti recenti

- A mano dal sito, oppure
- rilanciando `import_excel.py` sul file Excel aggiornato o sull'estratto conto
  esportato dalla banca (serve una riga di intestazione con almeno "Data" e "Importo").
  Lo script è idempotente: i movimenti già presenti non vengono duplicati.

Categorie da rinominare o eliminare: dal Table Editor di Supabase (tabella `categorie`).

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
