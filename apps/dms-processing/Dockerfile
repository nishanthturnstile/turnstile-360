FROM python:3.13.18-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f AS build
WORKDIR /workspace/apps/dms-processing
RUN pip install --no-cache-dir uv==0.13.6
COPY apps/dms-processing/ ./
RUN uv lock --check && uv build

FROM python:3.13.18-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f
RUN useradd --create-home --uid 10001 processing
COPY --from=build /workspace/apps/dms-processing/dist/*.whl /tmp/wheels/
RUN pip install --no-cache-dir /tmp/wheels/*.whl && rm -rf /tmp/wheels
USER processing
CMD ["turnstile-processing"]
