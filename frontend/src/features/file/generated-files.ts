export type GeneratedFileKind = "csv" | "doc" | "json" | "md" | "txt";

export type GeneratedFileTemplate = {
  content: BlobPart[];
  defaultName: string;
  mimeType: string;
};

export function createGeneratedFileTemplate(kind: GeneratedFileKind): GeneratedFileTemplate {
  if (kind === "csv") {
    return {
      content: ["name,value\n"],
      defaultName: "New Table.csv",
      mimeType: "text/csv",
    };
  }

  if (kind === "json") {
    return {
      content: ["{\n  \"name\": \"Untitled\"\n}\n"],
      defaultName: "New Data.json",
      mimeType: "application/json",
    };
  }

  if (kind === "md") {
    return {
      content: ["# Untitled\n"],
      defaultName: "New Markdown.md",
      mimeType: "text/markdown",
    };
  }

  if (kind === "doc") {
    return {
      content: [createMinimalDocxBlob()],
      defaultName: "New Document.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  return {
    content: [""],
    defaultName: "New Text.txt",
    mimeType: "text/plain",
  };
}

function createMinimalDocxBlob() {
  return createZipBlob([
    {
      path: "[Content_Types].xml",
      content: xmlText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    },
    {
      path: "_rels/.rels",
      content: xmlText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    },
    {
      path: "word/document.xml",
      content: xmlText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p/>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`),
    },
  ], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

function xmlText(value: string) {
  return new TextEncoder().encode(value);
}

function createZipBlob(files: Array<{ content: Uint8Array; path: string }>, type: string) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const pathBytes = new TextEncoder().encode(file.path);
    const crc = crc32(file.content);
    const localHeader = createLocalFileHeader(pathBytes, file.content, crc);
    localParts.push(localHeader, file.content);
    centralParts.push(createCentralDirectoryHeader(pathBytes, file.content, crc, offset));
    offset += localHeader.length + file.content.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = createEndOfCentralDirectory(files.length, centralSize, centralOffset);
  return new Blob([concatBytes([...localParts, ...centralParts, end]).buffer], { type });
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function createLocalFileHeader(pathBytes: Uint8Array, content: Uint8Array, crc: number) {
  const header = new Uint8Array(30 + pathBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, content.length, true);
  view.setUint32(22, content.length, true);
  view.setUint16(26, pathBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(pathBytes, 30);
  return header;
}

function createCentralDirectoryHeader(pathBytes: Uint8Array, content: Uint8Array, crc: number, offset: number) {
  const header = new Uint8Array(46 + pathBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, content.length, true);
  view.setUint32(24, content.length, true);
  view.setUint16(28, pathBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(pathBytes, 46);
  return header;
}

function createEndOfCentralDirectory(fileCount: number, centralSize: number, centralOffset: number) {
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return end;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
