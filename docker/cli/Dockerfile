# Dockerfile

# To be run from the project root, eg:
# docker build -f docker/cli/Dockerfile .

# pull the official docker image
FROM python:3.12-slim

# set work directory
WORKDIR /app

# set env variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# install external dependencies (GEMMI and snakemake dependencies)
RUN apt-get update && apt-get install -y gemmi git && rm -rf /var/lib/apt/lists/*

# Install UV
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy project files for building
COPY pyproject.toml uv.lock LICENSE README.md ./
COPY bio3dbeacons bio3dbeacons

# Install python dependencies with CLI extras
RUN uv sync --frozen --extra cli

# copy schema
COPY resources resources

# copy Snakemake file and config
COPY .env Snakefile ./

# Ensure UV virtual environment binaries are in PATH
ENV PATH="/app/.venv/bin:$PATH"

# run cli command by default
ENTRYPOINT ["uv", "run", "3dbeacons-cli"]
