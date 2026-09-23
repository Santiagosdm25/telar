"""DDL de las tablas que se aprovisionan en la base externa de la cuenta.

Mismo SQL para Postgres y MySQL: ids varchar(36) con uuid4 generado en Python.
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
