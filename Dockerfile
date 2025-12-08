# pull the official docker image
FROM python:3.12-slim

# install Gemmi from system
RUN apt-get update && apt-get install -y gemmi && rm -rf /var/lib/apt/lists/*

# set work directory
WORKDIR /app

# Install UV
RUN pip install uv

COPY . /app

# install CLI dependencies
RUN uv sync
