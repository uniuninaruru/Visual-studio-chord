FROM python:3.12.13-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY backend/requirements.runtime.lock /tmp/requirements.runtime.lock
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      "pip==25.0.1" "setuptools==83.0.0" \
    && python -m pip install --no-cache-dir --disable-pip-version-check \
      --requirement /tmp/requirements.runtime.lock

COPY backend /app/backend
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      --no-deps --no-build-isolation /app/backend \
    && useradd --create-home --uid 10001 harmony

USER harmony

EXPOSE 8765

CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "/app/backend", "--host", "0.0.0.0", "--port", "8765"]
