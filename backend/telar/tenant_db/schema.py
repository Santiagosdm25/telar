"""
DDL de las 3 tablas que se aprovisionan en la base externa que cada cuenta
trae -- roles, usuarios y contactos/conversaciones -- relacionadas por
foreign key de verdad: telar_users.role_id -> telar_roles.id,
telar_conversations.contact_id -> telar_contacts.id,
telar_conversations.assigned_user_id -> telar_users.id.

Mismo SQL para Postgres y MySQL: id como varchar(36) (un UUID en texto,
generado en Python con uuid4) en vez de un tipo uuid nativo, que MySQL no
tiene -- así no hace falta mantener dos plantillas de DDL. El único punto
donde los dos motores difieren es el sufijo "ENGINE=InnoDB" que MySQL
necesita para foreign keys reales (ver provisioning.py).

Esto NO reemplaza la Postgres compartida donde vive el resto de Telar
(auth, checkpoints de LangGraph, kb vectorial) -- es la base que el
cliente trae para operar sus propios datos de negocio, hoy separada de
esa. Enrutar las lecturas/escrituras de contactos y conversaciones para
que usen esta conexión en vez de la compartida es el siguiente paso, no
parte de este aprovisionamiento.
"""

from __future__ import annotations

CREATE_STATEMENTS: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS telar_roles (
        id    varchar(36) NOT NULL PRIMARY KEY,
        name  varchar(50) NOT NULL UNIQUE
    ){suffix}
    """,
    """
    CREATE TABLE IF NOT EXISTS telar_users (
        id          varchar(36) NOT NULL PRIMARY KEY,
        email       varchar(255) NOT NULL UNIQUE,
        name        varchar(255),
        role_id     varchar(36),
        created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES telar_roles(id)
    ){suffix}
    """,
    """
    CREATE TABLE IF NOT EXISTS telar_contacts (
        id           varchar(36) NOT NULL PRIMARY KEY,
        external_id  varchar(255) NOT NULL UNIQUE,
        name         varchar(255),
        phone        varchar(50),
        email        varchar(255),
        created_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    ){suffix}
    """,
    """
    CREATE TABLE IF NOT EXISTS telar_conversations (
        id                 varchar(36) NOT NULL PRIMARY KEY,
        contact_id         varchar(36) NOT NULL,
        assigned_user_id   varchar(36),
        status             varchar(20) NOT NULL DEFAULT 'bot',
        created_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (contact_id) REFERENCES telar_contacts(id),
        FOREIGN KEY (assigned_user_id) REFERENCES telar_users(id)
    ){suffix}
    """,
]

DEFAULT_ROLES: list[str] = ["administrator", "supervisor", "agent"]
