FROM eclipse-temurin:21-jre-jammy@sha256:1eac8b8fee11ca7d6725a48bc5d41992ed1561504ebae25490d2d062847e8269 AS java
FROM python:3.13.18-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f AS tika
RUN python - <<'PYCODE'
import hashlib, pathlib, urllib.request, urllib.error, zipfile
import shutil
path=pathlib.Path('/tmp/tika.zip')
for base in ('https://dlcdn.apache.org/tika/4.2.0/', 'https://archive.apache.org/dist/tika/4.2.0/'):
    try:
        with urllib.request.urlopen(base+'tika-app-4.2.0.zip',timeout=30) as response, path.open('wb') as output:
            shutil.copyfileobj(response,output)
        break
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
else:
    raise RuntimeError('Pinned Tika distribution unavailable')
assert hashlib.sha512(path.read_bytes()).hexdigest() == 'a9966e238fc0178a4ba3e7dd870c7b59894a16ec7759fc5582d62d0ecf9006b84e8ec97270ec2c3c0171acd57ef6ed351d55fa6884a4e52f2635fd148652bf0f'
with zipfile.ZipFile(path) as archive:
    for name in archive.namelist():
        if name in ('tika-app-4.2.0.jar','LICENSE','NOTICE') or name.startswith('lib/'):
            archive.extract(name,'/opt/tika')
PYCODE

FROM python:3.13.18-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f AS ocr
RUN apt-get update && apt-get install -y --no-install-recommends build-essential autoconf automake libtool pkg-config libleptonica-dev && rm -rf /var/lib/apt/lists/*
RUN python - <<'PYCODE'
import urllib.request,hashlib,tarfile,pathlib
p=pathlib.Path('/tmp/tesseract.tar.gz')
with urllib.request.urlopen('https://github.com/tesseract-ocr/tesseract/archive/refs/tags/5.5.4.tar.gz',timeout=30) as r:p.write_bytes(r.read())
assert hashlib.sha256(p.read_bytes()).hexdigest()=='a8dbf8b8c8ee427ff6ad1d99116502feaf59440af1adb893caf60a6576826cf4'
with tarfile.open(p) as archive:archive.extractall('/build',filter='data')
root=pathlib.Path('/opt/ocr/tessdata');root.mkdir(parents=True)
for name,sha in [('eng.traineddata','7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'),('osd.traineddata','9cf5d576fcc47564f11265841e5ca839001e7e6f38ff7f7aacf46d15a96b00ff')]:
    with urllib.request.urlopen('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/'+name,timeout=30) as r:data=r.read()
    assert hashlib.sha256(data).hexdigest()==sha
    (root/name).write_bytes(data)
with urllib.request.urlopen('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/LICENSE',timeout=30) as r:(root/'LICENSE').write_bytes(r.read())
PYCODE
WORKDIR /build/tesseract-5.5.4
RUN ./autogen.sh && ./configure --prefix=/opt/ocr --disable-shared --disable-openmp --disable-graphics && make -j2 && make install && cp LICENSE /opt/ocr/LICENSE
# Carry the exact linked codecs with the runtime; exclude the platform C library/loader.
RUN python - <<'PYCODE'
import pathlib,subprocess,shutil
root=pathlib.Path('/opt/ocr/lib');root.mkdir(exist_ok=True)
for line in subprocess.check_output(['ldd','/opt/ocr/bin/tesseract'],text=True).splitlines():
    if ' => /' not in line:continue
    path=pathlib.Path(line.split('=>')[1].split()[0])
    if path.name.startswith(('libc.so','libm.so','libpthread.so','libdl.so','librt.so')):continue
    shutil.copy2(path,root/path.name)
shutil.copytree('/usr/share/doc','/opt/ocr/legal',dirs_exist_ok=True,ignore_dangling_symlinks=True)
PYCODE

FROM python:3.13.18-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f AS build
WORKDIR /workspace/apps/dms-processing
RUN pip install --no-cache-dir uv==0.13.6
COPY apps/dms-processing/ ./
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
RUN uv sync --locked --no-dev --no-editable && uv build


FROM python:3.13.18-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap=0.8.0-2+deb12u1 util-linux=2.38.1-5+deb12u3 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 processing
COPY --from=build /opt/venv /opt/venv
COPY --from=tika /opt/tika /opt/tika
COPY --from=java /opt/java/openjdk /opt/java/openjdk
COPY --from=ocr /opt/ocr /opt/ocr
ARG DMS_RELEASE=development
LABEL org.opencontainers.image.version=$DMS_RELEASE
ENV PATH="/opt/venv/bin:$PATH"
COPY LICENSE THIRD_PARTY_NOTICES /usr/share/doc/thaarei/
USER processing
CMD ["turnstile-processing", "check"]

# Opt-in target only. Default/scanner/extractor images contain no Docling or model bundle.
FROM build AS structured-build
RUN uv sync --locked --no-dev --no-editable --extra structured
RUN python scripts/prefetch_structure.py --output /opt/structure

FROM runtime AS structured
USER root
COPY --from=structured-build /opt/venv /opt/venv
COPY --from=structured-build /opt/structure /opt/structure
RUN ln -s ../share/tessdata/configs /opt/ocr/tessdata/configs
ENV DMS_STRUCTURE_ENABLED=true
USER processing

FROM runtime AS default
