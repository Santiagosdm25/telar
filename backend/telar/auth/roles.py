"""Roles de cuenta. Valores idénticos al enum account_role de Postgres."""

from __future__ import annotations

from enum import Enum


class AccountRole(str, Enum):
    ADMINISTRATOR = "administrator"
    SUPERVISOR = "supervisor"
    AGENT = "agent"
