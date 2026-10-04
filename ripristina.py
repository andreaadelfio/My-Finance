"""Ripristina una o più tabelle da un backup fatto con backup.py.

Uso:
    python3 ripristina.py backup/myfinance-backup-AAAA-MM-GG.json investimenti [altre tabelle]

Cancella tutte le righe della tabella e reinserisce quelle del backup (le righe con un id
automatico ricevono un id nuovo). Chiede conferma prima di scrivere.

Funziona per le tabelle che le altre non richiamano per id: investimenti, movimenti_fineco,
mappatura_titoli, quotazioni, watchlist, saldi, riepiloghi_annuali. Per categorie, movimenti,
budget e mappatura_categorie (collegate fra loro dagli id delle categorie e con i trigger) il
ripristino va fatto a mano.
"""
import json
import sys
from pathlib import Path

from backup import TABELLE
from import_excel import Supabase, read_config

RIPRISTINABILI = {"investimenti", "movimenti_fineco", "mappatura_titoli", "quotazioni", "watchlist", "saldi", "riepiloghi_annuali"}
# Colonne calcolate dal database: non si possono inserire
COLONNE_AUTOMATICHE = {"id", "anno", "mese"}


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    backup = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    tabelle = sys.argv[2:]
    for tabella in tabelle:
        if tabella not in RIPRISTINABILI:
            raise SystemExit(f"{tabella}: non ripristinabile con questo script (vedi l'aiuto in cima al file).")
        if tabella not in backup["tabelle"]:
            raise SystemExit(f"{tabella}: non c'è nel backup.")

    print(f"Backup del {backup['creato_il']}.")
    for tabella in tabelle:
        print(f"  {tabella}: le righe attuali verranno sostituite con le {len(backup['tabelle'][tabella])} del backup")
    if input('Scrivi "SI" per procedere: ').strip() != "SI":
        raise SystemExit("Annullato, nessuna modifica.")

    db = Supabase(*read_config())
    for tabella in tabelle:
        chiave = TABELLE[tabella]
        db.request("DELETE", f"{tabella}?{chiave}=not.is.null")
        righe = backup["tabelle"][tabella]
        if chiave == "id":
            righe = [{k: v for k, v in r.items() if k not in COLONNE_AUTOMATICHE} for r in righe]
        db.insert(tabella, righe)
        print(f"{tabella}: ripristinate {len(righe)} righe")


if __name__ == "__main__":
    main()
