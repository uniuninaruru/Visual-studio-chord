FROM python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY backend/requirements.runtime.lock /tmp/requirements.runtime.lock
COPY backend/requirements-acceleration-cuda.lock /tmp/requirements-acceleration-cuda.lock
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      "pip==25.0.1" "setuptools==83.0.0" \
    && python -m pip install --no-cache-dir --disable-pip-version-check \
      --requirement /tmp/requirements.runtime.lock \
    && python -m pip install --no-cache-dir --disable-pip-version-check \
      --requirement /tmp/requirements-acceleration-cuda.lock

COPY backend /app/backend
COPY configs /app/configs
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      --no-deps --no-build-isolation /app/backend \
    && useradd --create-home --uid 10001 harmony

USER harmony

EXPOSE 8765

CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "/app/backend", "--host", "0.0.0.0", "--port", "8765"]
