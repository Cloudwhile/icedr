const path = require('node:path');
const { existsSync, readFileSync } = require('node:fs');

const workspaceRoot = path.resolve(__dirname, '..');
const metadataFile = path.join(workspaceRoot, 'binary-metadata.json');

function resolveBinaryMetadata() {
  const config = loadBinaryMetadataConfig();
  return {
    comments:
      process.env.ICEDR_BINARY_COMMENTS || config.comments || 'Standalone ICEDR binary',
    companyName:
      process.env.ICEDR_BINARY_COMPANY_NAME || config.companyName || 'ICEDR',
    copyright:
      process.env.ICEDR_BINARY_COPYRIGHT ||
      config.copyright ||
      `Copyright (C) ${new Date().getUTCFullYear()} ICEDR`,
    fileDescription:
      process.env.ICEDR_BINARY_FILE_DESCRIPTION ||
      config.fileDescription ||
      config.description ||
      'ICEDR',
    icon:
      process.env.ICEDR_BINARY_ICON || config.icon || 'frontend/public/logo.png',
    internalName:
      process.env.ICEDR_BINARY_INTERNAL_NAME || config.internalName || 'icedr',
    productName:
      process.env.ICEDR_BINARY_PRODUCT_NAME || config.productName || 'ICEDR',
  };
}

function loadBinaryMetadataConfig() {
  if (!existsSync(metadataFile)) {
    throw new Error(`Binary metadata file does not exist: ${path.relative(workspaceRoot, metadataFile)}`);
  }

  try {
    const parsed = JSON.parse(readFileSync(metadataFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid binary metadata file ${path.relative(workspaceRoot, metadataFile)}: ${message}`);
  }

  throw new Error(`Binary metadata file must contain a JSON object: ${path.relative(workspaceRoot, metadataFile)}`);
}

module.exports = {
  resolveBinaryMetadata,
};
