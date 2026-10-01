PORT ?= 8002
HOST ?= 127.0.0.1
SITE_DIR ?= .

all: git

# Su Windows i target passano a make-windows.ps1 (stessi comandi, senza bash/xdg-open/pkill)
ifeq ($(OS),Windows_NT)
PS = powershell -NoProfile -ExecutionPolicy Bypass -File make-windows.ps1

git dev stop backup:
	@$(PS) $@ -Port $(PORT) -HostName $(HOST) -SiteDir "$(SITE_DIR)"

else

# Copia di tutte le tabelle in backup/myfinance-backup-AAAA-MM-GG.json
backup:
	python3 backup.py

git:
	git add --all
	git commit -m "Updated website at $(shell date)"
	git push

dev:
	@echo "Avvio server su http://$(HOST):$(PORT)/index.html"
	python3 -m http.server "$(PORT)" --bind "$(HOST)" --directory "$(SITE_DIR)" >/dev/null 2>&1 &
	@if command -v xdg-open >/dev/null 2>&1; then \
		xdg-open "http://$(HOST):$(PORT)/index.html" >/dev/null 2>&1; \
	elif command -v open >/dev/null 2>&1; then \
		open "http://$(HOST):$(PORT)/index.html"; \
	else \
		echo "Apri manualmente: http://$(HOST):$(PORT)/index.html"; \
	fi

stop:
	@if pkill -f "python3 -m http.server $(PORT)" 2>/dev/null; then \
		echo "Server fermato sulla porta $(PORT)"; \
	else \
		echo "Nessun server trovato sulla porta $(PORT)"; \
	fi

endif

.PHONY: all git dev stop backup
