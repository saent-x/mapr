# Mapr AI Gateway worker — FastAPI service that exposes /v1/qa, /embed,
# /ner (GLiNER multilingual), and /generate (proxies to private llama.cpp).
#
# Built to run as a Coolify service. Use `python:3.11-slim` because the
# inference libraries don't need anything beyond CPU + AVX2.

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TRANSFORMERS_NO_ADVISORY_WARNINGS=1 \
    OMP_NUM_THREADS=4

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ca-certificates \
        libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
 && pip install -r requirements.txt

COPY main.py /app/main.py

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=6 --start-period=90s \
    CMD python -c "import os,sys,urllib.request; req=urllib.request.Request('http://localhost:8080/healthz', headers={'x-mapr-token': os.environ.get('MAPR_AI_BEARER','')}); sys.exit(0 if urllib.request.urlopen(req, timeout=3).status==200 else 1)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
