PORT ?= 8002
HOST ?= 127.0.0.1
SITE_DIR ?= .

all: git

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

.PHONY: all git dev stop
