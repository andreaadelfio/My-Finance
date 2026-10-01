"""Backup del database MyFinance: salva tutte le tabelle in un file JSON.

Uso:
    python3 backup.py              # crea backup/myfinance-backup-AAAA-MM-GG.json
    python3 backup.py <cartella>   # nella cartella indicata

URL e chiave vengono letti da assets/config.js, come per import_excel.py.
I file di backup contengono dati personali: il .gitignore li esclude dal repository.
"""
import datetime as dt
import json
import sys
from pathlib import Path

from import_excel import Supabase, read_config

# Tabella -> colonna per ordinare (e paginare) le righe
TABELLE = {
    "categorie": "id",
    "movimenti": "id",
    "budget": "id",
    "saldi": "anno",
    "riepiloghi_annuali": "anno",
    "investimenti": "id",
    "mappatura_categorie": "id",
    "quotazioni": "posizione",
    "watchlist": "isin",
}


def main():
    cartella = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "backup"
    cartella.mkdir(parents=True, exist_ok=True)
    db = Supabase(*read_config())

    tabelle = {}
    for tabella, ordine in TABELLE.items():
        tabelle[tabella] = db.select_all(tabella, order=ordine)
        print(f"{tabella}: {len(tabelle[tabella])} righe")

    oggi = dt.date.today().isoformat()
    file = cartella / f"myfinance-backup-{oggi}.json"
    backup = {"creato_il": dt.datetime.now().isoformat(timespec="seconds"), "tabelle": tabelle}
    file.write_text(json.dumps(backup, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Backup salvato in {file}")


if __name__ == "__main__":
    main()
