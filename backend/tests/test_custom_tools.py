"""
Tests de las tools configurables. Lógica pura: construcción de schema
dinámico, guarda SSRF y chequeo de solo-lectura de SQL. Sin red ni DB.
"""

from __future__ import annotations

import socket

import pytest

from telar.custom_tools import http_tool
from telar.custom_tools.http_tool import UnsafeURLError, check_url_is_safe
from telar.custom_tools.schema import build_args_model
from telar.custom_tools.sql_tool import UnsafeQueryError, check_query_is_readonly


def test_build_args_model_required_field_is_enforced():
    Model = build_args_model(
        {"properties": {"campo": {"type": "string"}}, "required": ["campo"]}
    )
    with pytest.raises(Exception):
        Model()
    assert Model(campo="valor").campo == "valor"


def test_build_args_model_optional_field_defaults_to_none():
    Model = build_args_model({"properties": {"opcional": {"type": "integer"}}})
    assert Model().opcional is None
    assert Model(opcional=5).opcional == 5


def test_check_url_is_safe_allows_public_host(monkeypatch):
    # Sin red: se simula la resolución DNS para no depender de internet.
    monkeypatch.setattr(
        http_tool.socket,
        "getaddrinfo",
        lambda host, port: [(socket.AF_INET, None, None, "", ("8.8.8.8", 0))],
    )
    check_url_is_safe("https://api.miempresa.com/pedidos")


def test_check_url_is_safe_blocks_loopback():
    with pytest.raises(UnsafeURLError):
        check_url_is_safe("http://127.0.0.1/algo")


def test_check_url_is_safe_blocks_private_range():
    with pytest.raises(UnsafeURLError):
        check_url_is_safe("http://10.0.0.5/algo")


def test_check_url_is_safe_blocks_cloud_metadata_ip():
    with pytest.raises(UnsafeURLError):
        check_url_is_safe("http://169.254.169.254/latest/meta-data/")


def test_check_url_is_safe_blocks_non_http_scheme():
    with pytest.raises(UnsafeURLError):
        check_url_is_safe("file:///etc/passwd")


def test_check_query_is_readonly_allows_select():
    check_query_is_readonly("SELECT * FROM orders WHERE id = %(id)s")
    check_query_is_readonly("  with x as (select 1) select * from x")


def test_check_query_is_readonly_rejects_write_statements():
    for query in ["INSERT INTO orders VALUES (1)", "UPDATE orders SET x=1", "DELETE FROM orders"]:
        with pytest.raises(UnsafeQueryError):
            check_query_is_readonly(query)
