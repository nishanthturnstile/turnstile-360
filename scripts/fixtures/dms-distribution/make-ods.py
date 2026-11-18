"""Owned, bounded ODS input for the independent HTTP qualification journey."""

import sys
from zipfile import ZIP_STORED, ZipFile

with ZipFile(sys.argv[1], "w", compression=ZIP_STORED) as archive:
    archive.writestr("mimetype", "application/vnd.oasis.opendocument.spreadsheet")
    archive.writestr(
        "META-INF/manifest.xml",
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">'
        '<manifest:file-entry manifest:full-path="/" '
        'manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>'
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
        "</manifest:manifest>",
    )
    archive.writestr(
        "content.xml",
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
        'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
        'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">'
        '<office:body><office:spreadsheet><table:table table:name="Qualification">'
        '<table:table-row><table:table-cell office:value-type="string">'
        "<text:p>qualifytoken bounded synthetic table</text:p></table:table-cell>"
        '<table:table-cell office:value-type="float" office:value="42">'
        "<text:p>42</text:p></table:table-cell></table:table-row>"
        "</table:table></office:spreadsheet></office:body></office:document-content>",
    )
