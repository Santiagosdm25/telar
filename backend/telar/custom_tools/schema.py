"""
Construye el modelo Pydantic (args_schema de la tool) a partir del
`schema` que la cuenta guarda en la fila de `tools`.

Formato mínimo esperado:
    {
        "properties": {
            "campo": {"type": "string", "description": "..."}
        },
        "required": ["campo"]
    }
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, create_model

_TYPE_MAP: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def build_args_model(schema: dict[str, Any], *, model_name: str = "ToolArgs") -> type[BaseModel]:
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))

    fields: dict[str, Any] = {}
    for name, spec in properties.items():
        py_type = _TYPE_MAP.get(spec.get("type", "string"), str)
        description = spec.get("description")

        if name in required:
            fields[name] = (py_type, Field(..., description=description))
        else:
            fields[name] = (py_type | None, Field(None, description=description))

    return create_model(model_name, **fields)
