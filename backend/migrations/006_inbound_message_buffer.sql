-- Cola persistente para mensajes entrantes en la ventana de debounce.
-- Sin esto, un crash del proceso entre el 200 OK a Meta y que
-- worker/pipeline.py termine de procesar el lote pierde el mensaje sin
-- dejar rastro (Meta no reintenta un webhook que ya devolvió éxito).
--
-- El mensaje se inserta acá ANTES de que el webhook responda 200; se
-- borra recién cuando worker/pipeline.py terminó de procesarlo. Si el
-- proceso muere en el medio, lo que quede acá al arrancar de nuevo se
-- reprocesa -- ver worker/dispatcher.py recover_pending().

CREATE TABLE inbound_message_buffer (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inbox_id            uuid NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    contact_external_id text NOT NULL,
    channel_message_id  text NOT NULL,
    payload             jsonb NOT NULL,
    received_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inbound_message_buffer_dedup
    ON inbound_message_buffer (inbox_id, channel_message_id);

CREATE INDEX inbound_message_buffer_key
    ON inbound_message_buffer (inbox_id, contact_external_id);
