FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# tippecanoe (builds the vector tiles), from the Felt fork
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git libsqlite3-dev zlib1g-dev \
    && git clone --depth 1 https://github.com/felt/tippecanoe /tmp/tippecanoe \
    && make -C /tmp/tippecanoe -j"$(nproc)" \
    && make -C /tmp/tippecanoe install \
    && rm -rf /tmp/tippecanoe \
    && apt-get purge -y build-essential git \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# pmtiles CLI (basemap extract and conversion)
ARG PMTILES_VERSION=1.22.1
RUN curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz" \
      | tar -xz -C /usr/local/bin pmtiles \
    && chmod +x /usr/local/bin/pmtiles

# supercronic runs the schedule - there is no cron daemon in this image
ARG SUPERCRONIC_VERSION=v0.2.33
RUN curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
      -o /usr/local/bin/supercronic \
    && chmod +x /usr/local/bin/supercronic

RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir requests==2.32.3 shapely==2.0.6

WORKDIR /pipeline
COPY . /pipeline
ENV POTA_DATA=/data
CMD ["bash", "/pipeline/run.sh"]
