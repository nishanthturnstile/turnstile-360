"""Collect actual license/notice material from a credential-free production image export."""

import argparse
import io
import json
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


def legal_name(path: str) -> bool:
    parts = PurePosixPath(path).parts
    if ".." in parts or path.startswith("/"):
        return False
    name = parts[-1].lower() if parts else ""
    return (
        name.startswith(("license", "licence", "copying", "copyright", "notice"))
        or "/legal/" in "/" + path.lower()
        or path.startswith(("usr/share/doc/", "usr/share/common-licenses/", "usr/share/licenses/"))
    )


def collect(source: Path, output: Path) -> dict[str, int]:
    files, jar_files, total = 0, 0, 0
    with tarfile.open(source) as root, tarfile.open(output, "w:gz") as target:
        for entry in root:
            if not entry.isfile():
                continue
            if legal_name(entry.name):
                if entry.size > 20971520:
                    raise ValueError("Legal file bound")
                stream = root.extractfile(entry)
                if stream:
                    target.addfile(entry, stream)
                    files += 1
                    total += entry.size
            elif entry.name.endswith(".jar") and entry.size <= 536870912:
                stream = root.extractfile(entry)
                if not stream:
                    continue
                with tempfile.TemporaryFile() as jar:
                    while block := stream.read(1048576):
                        jar.write(block)
                    jar.seek(0)
                    with zipfile.ZipFile(jar) as archive:
                        for member in archive.infolist():
                            if member.is_dir() or not legal_name(member.filename):
                                continue
                            if member.file_size > 20971520:
                                raise ValueError("Embedded notice bound")
                            data = archive.read(member)
                            info = tarfile.TarInfo("embedded/" + entry.name + "/" + member.filename)
                            info.mode, info.size = 0o644, len(data)
                            target.addfile(info, io.BytesIO(data))
                            jar_files += 1
                            total += len(data)
            if total > 1073741824:
                raise ValueError("Legal archive bound")
    if not files:
        raise ValueError("Missing image legal material")
    return {"files": files, "embeddedNotices": jar_files, "bytes": total}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(json.dumps(collect(args.source, args.output)))
