FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY pyproject.toml README.md ./
COPY telar ./telar
# openai: embeddings de la base de conocimiento y proveedores LLM
# openai/openrouter (OpenRouter usa la API compatible con OpenAI).
# ollama: proveedor LLM local, opcional pero liviano de sumar acá.
RUN pip install --no-cache-dir ".[openai,ollama]"

RUN useradd --create-home --uid 1000 telar \
    && mkdir -p /app/data/media \
    && chown -R telar:telar /app/data
USER telar

EXPOSE 8000
CMD ["uvicorn", "telar.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
