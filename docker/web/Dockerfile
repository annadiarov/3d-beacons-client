# Dockerfile

# pull the official docker image
FROM python:3.12-slim

# install curl (for healthcheck)
RUN apt-get update && apt-get -y install curl && rm -rf /var/lib/apt/lists/*

# set work directory
WORKDIR /app

# set env variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Install UV
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy project files
COPY pyproject.toml uv.lock LICENSE README.md ./
COPY bio3dbeacons bio3dbeacons

# Install dependencies using UV with API extras
RUN uv sync --frozen --extra api
