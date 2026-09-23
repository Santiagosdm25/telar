-- Limpieza de esquema: tablas y columnas que quedaron del diseño inicial
-- sin que ningún código las haya usado nunca (confirmado con grep sobre
-- todo el backend y el frontend, y con conteo en vivo: 0 filas / 0
-- valores no nulos en toda la base antes de este DROP).
--
-- labels/conversation_labels/canned_responses/custom_attribute_definitions:
-- etiquetas, respuestas rápidas y atributos personalizados de contacto --
-- funciones reales que un día pueden valer la pena, pero hoy no tienen ni
-- backend ni UI. Se prefiere no dejarlas como decoración confusa en el
-- esquema; se vuelven a agregar el día que se implementen de punta a
-- punta, como su propia ronda.
--
-- inbox_members: no tiene ningún endpoint ni columna que lo consulte --
-- quién puede ver un inbox se resuelve hoy por pertenencia a la cuenta,
-- no por esta tabla.
--
-- inboxes.bot_id / conversations.bot_id: vestigio de un diseño anterior
-- (varios bots posibles por cuenta) que el modelo actual ya no usa -- "un
-- bot por cuenta" se resuelve por account_id (ver db/repositories.py
-- get_bot_for_account), nunca por estas columnas, que siempre valían NULL.

DROP TABLE IF EXISTS conversation_labels;  -- antes que labels (FK)
DROP TABLE IF EXISTS labels;
DROP TABLE IF EXISTS canned_responses;
DROP TABLE IF EXISTS custom_attribute_definitions;
DROP TABLE IF EXISTS inbox_members;

ALTER TABLE inboxes DROP COLUMN bot_id;
ALTER TABLE conversations DROP COLUMN bot_id;
