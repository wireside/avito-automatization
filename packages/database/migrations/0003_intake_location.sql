-- Default receiving destination for the first warehouse slice. No sellable release.
INSERT INTO warehouses(code, name) VALUES ('MAIN', 'Основной склад') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
INSERT INTO stock_locations(warehouse_id, code, name, kind)
SELECT id, 'RECEIVING', 'Приёмка', 'QUARANTINE' FROM warehouses WHERE code = 'MAIN'
ON CONFLICT(warehouse_id, code) DO NOTHING;
