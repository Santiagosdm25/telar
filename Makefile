# Delegan en backend/Makefile, donde vive el docker-compose.yml.
# Así `make <objetivo>` funciona desde la raíz del repo también.

.DEFAULT_GOAL := help

# Sin esto, la regla `%:` intentaría "rehacer" el propio Makefile en cada llamada.
Makefile: ;

%:
	@$(MAKE) --no-print-directory -C backend $@
