# MAPR v2 embedding service (CPU). Also runs the bake-off: same image, same code path.
FROM python:3.12.15-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements-torch-cpu.txt requirements.txt ./
RUN pip install -r requirements-torch-cpu.txt \
 && pip install -r requirements.txt

COPY mapr_embedder ./mapr_embedder
COPY bakeoff ./bakeoff

RUN useradd --uid 10001 --create-home app \
 && install -d -o 10001 -g 10001 /models
USER 10001

# 12 vCPU host. One process, one model; torch uses every thread for each batch.
ENV MODEL_CACHE_DIR=/models \
    HF_HOME=/models/.hf \
    TORCH_THREADS=12 \
    OMP_NUM_THREADS=12 \
    MKL_NUM_THREADS=12 \
    OPENBLAS_NUM_THREADS=12 \
    TOKENIZERS_PARALLELISM=false

EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "--factory", "mapr_embedder.server:app_factory", "--host", "0.0.0.0", "--port", "8788", "--workers", "1", "--timeout-keep-alive", "30", "--no-access-log"]
