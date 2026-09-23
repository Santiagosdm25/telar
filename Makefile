# Delegan en telar/Makefile, donde vive el docker-compose.yml.
# Así `make <objetivo>` funciona desde la raíz del repo también.

.DEFAULT_GOAL := help

%:
	@$(MAKE) --no-print-directory -C telar $@
