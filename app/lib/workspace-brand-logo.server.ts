import { normalizeWorkspaceBrandLogo } from "~/lib/data/workspace-branding.server";

export const WORKSPACE_BRAND_LOGO_MAX_BYTES = 48_000;
export const WORKSPACE_BRAND_LOGO_MAX_MULTIPART_BYTES =
	WORKSPACE_BRAND_LOGO_MAX_BYTES + 16_384;

const MAX_LOGO_DIMENSION = 8_192;
const MAX_LOGO_PIXELS = 16_777_216;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type WorkspaceBrandLogoUploadResult =
	| { ok: true; brandLogo?: string }
	| { ok: false; message: string };

const ALLOWED_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function parseWorkspaceBrandLogoUpload(
	value: FormDataEntryValue | null,
): Promise<WorkspaceBrandLogoUploadResult> {
	if (value === null) {
		return { ok: true };
	}

	if (typeof value === "string") {
		return invalidLogo("Choose a PNG, JPEG, or WebP logo file.");
	}

	if (value.size === 0 && value.name.length === 0) {
		return { ok: true };
	}

	if (value.size === 0) {
		return invalidLogo("Choose a non-empty PNG, JPEG, or WebP logo.");
	}

	if (value.size > WORKSPACE_BRAND_LOGO_MAX_BYTES) {
		return invalidLogo("Logo must be 48 KB or smaller.");
	}

	if (!ALLOWED_LOGO_MIME_TYPES.has(value.type)) {
		return invalidLogo("Use a PNG, JPEG, or WebP logo. SVG files are not accepted.");
	}

	const bytes = new Uint8Array(await value.arrayBuffer());
	const detectedType = detectRasterMimeType(bytes);
	if (detectedType !== value.type) {
		return invalidLogo(
			"That file's contents do not match its image type. Choose a PNG, JPEG, or WebP logo.",
		);
	}

	if (!hasValidRasterStructure(bytes, detectedType)) {
		return invalidLogo("Choose a valid PNG, JPEG, or WebP logo.");
	}

	const dataUrl = `data:${detectedType};base64,${encodeBase64(bytes)}`;
	const brandLogo = normalizeWorkspaceBrandLogo(dataUrl);
	if (!brandLogo) {
		return invalidLogo("Choose a valid PNG, JPEG, or WebP logo.");
	}

	return { ok: true, brandLogo };
}

function hasValidRasterStructure(
	bytes: Uint8Array,
	mimeType: "image/png" | "image/jpeg" | "image/webp",
) {
	switch (mimeType) {
		case "image/png":
			return hasValidPngStructure(bytes);
		case "image/jpeg":
			return hasValidJpegStructure(bytes);
		case "image/webp":
			return hasValidWebpStructure(bytes);
	}
}

function hasValidPngStructure(bytes: Uint8Array) {
	if (bytes.length < 8 || !bytes.slice(0, 8).every((byte, index) => byte === PNG_SIGNATURE[index])) {
		return false;
	}

	let offset = 8;
	let sawHeader = false;
	let sawImageDataChunk = false;
	let imageDataBytes = 0;
	let imageDataEnded = false;
	let sawPalette = false;
	let colorType = 0;
	let bitDepth = 0;
	let sawEnd = false;

	while (offset < bytes.length) {
		if (offset + 12 > bytes.length) return false;
		const length = readUint32Be(bytes, offset);
		const chunkEnd = offset + 12 + length;
		if (chunkEnd > bytes.length) return false;

		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (!isPngChunkType(bytes, offset + 4)) return false;
		if (crc32(bytes.subarray(offset + 4, dataEnd)) !== readUint32Be(bytes, dataEnd)) {
			return false;
		}

		if (!isKnownPngChunk(type) && (bytes[offset + 4] & 0x20) === 0) return false;
		if (type === "acTL" || type === "fcTL" || type === "fdAT") return false;

		if (!sawHeader && type !== "IHDR") return false;
		if (type === "IHDR") {
			if (sawHeader || length !== 13) return false;
			const width = readUint32Be(bytes, dataStart);
			const height = readUint32Be(bytes, dataStart + 4);
			if (!hasSaneDimensions(width, height)) return false;
			bitDepth = bytes[dataStart + 8];
			colorType = bytes[dataStart + 9];
			if (!isValidPngBitDepth(bitDepth, colorType)) return false;
			if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || bytes[dataStart + 12] > 1) {
				return false;
			}
			sawHeader = true;
		} else if (type === "PLTE") {
			if (!sawHeader || sawPalette || length === 0 || length % 3 !== 0 || length > 768) return false;
			if (colorType === 0 || colorType === 4 || length / 3 > 1 << bitDepth) return false;
			if (sawImageDataChunk) return false;
			sawPalette = true;
		} else if (type === "IDAT") {
			if (!sawHeader || imageDataEnded) return false;
			if (colorType === 3 && !sawPalette) return false;
			sawImageDataChunk = true;
			imageDataBytes += length;
		} else if (type === "IEND") {
			if (!sawHeader || !sawImageDataChunk || imageDataBytes === 0 || length !== 0) return false;
			sawEnd = true;
			offset = chunkEnd;
			break;
		} else if (sawImageDataChunk) {
			imageDataEnded = true;
		}

		offset = chunkEnd;
	}

	return sawHeader && sawImageDataChunk && imageDataBytes > 0 && sawEnd && offset === bytes.length;
}

function hasValidJpegStructure(bytes: Uint8Array) {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

	let offset = 2;
	let sawFrame = false;
	let sawScan = false;
	let sawEnd = false;

	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) return false;
		while (offset < bytes.length && bytes[offset] === 0xff) offset++;
		if (offset >= bytes.length) return false;
		const marker = bytes[offset++];

		if (marker === 0xd9) {
			sawEnd = true;
			break;
		}
		if (marker === 0xd8 || marker === 0x00) return false;
		if (marker >= 0xd0 && marker <= 0xd7) continue;
		if (marker === 0x01) continue;
		if (offset + 2 > bytes.length) return false;

		const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
		if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
		const segmentStart = offset;
		const segmentData = offset + 2;

		if (isJpegFrameMarker(marker)) {
			if (sawFrame || segmentLength < 8) return false;
			const components = bytes[segmentData + 5];
			if (components === 0 || components > 4 || segmentLength < 8 + components * 3) return false;
			const width = (bytes[segmentData + 3] << 8) | bytes[segmentData + 4];
			const height = (bytes[segmentData + 1] << 8) | bytes[segmentData + 2];
			if (!hasSaneDimensions(width, height)) return false;
			sawFrame = true;
		} else if (marker === 0xda) {
			if (!sawFrame || segmentLength < 6) return false;
			const components = bytes[segmentData];
			if (components === 0 || components > 4 || segmentLength < 6 + components * 2) return false;
			sawScan = true;
		}

		offset = segmentStart + segmentLength;
		if (marker === 0xda) {
			const scanResult = scanJpegEntropy(bytes, offset);
			if (scanResult === null) return false;
			offset = scanResult.offset;
			sawEnd ||= scanResult.sawEnd;
		}
	}

	return sawFrame && sawScan && sawEnd && offset === bytes.length;
}

function scanJpegEntropy(bytes: Uint8Array, offset: number) {
	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset++;
			continue;
		}

		const markerStart = offset;
		while (offset < bytes.length && bytes[offset] === 0xff) offset++;
		if (offset >= bytes.length) return null;
		const marker = bytes[offset++];
		if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (marker === 0xd9) return { offset, sawEnd: true };
		return { offset: markerStart, sawEnd: false };
	}
	return null;
}

function hasValidWebpStructure(bytes: Uint8Array) {
	if (
		bytes.length < 20 ||
		String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
		String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP" ||
		readUint32Le(bytes, 4) !== bytes.length - 8
	) {
		return false;
	}

	let offset = 12;
	let sawImage = false;
	let dimensions: [number, number] | null = null;

	while (offset < bytes.length) {
		if (offset + 8 > bytes.length) return false;
		const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
		const length = readUint32Le(bytes, offset + 4);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		const chunkEnd = dataEnd + (length & 1);
		if (dataEnd > bytes.length || chunkEnd > bytes.length) return false;
		if ((length & 1) !== 0 && bytes[dataEnd] !== 0) return false;

		if (type === "VP8 ") {
			if (length < 10 || (bytes[dataStart] & 1) !== 0) return false;
			if (bytes[dataStart + 3] !== 0x9d || bytes[dataStart + 4] !== 0x01 || bytes[dataStart + 5] !== 0x2a) {
				return false;
			}
			const width = ((bytes[dataStart + 7] & 0x3f) << 8) | bytes[dataStart + 6];
			const height = ((bytes[dataStart + 9] & 0x3f) << 8) | bytes[dataStart + 8];
			if (!hasSaneDimensions(width, height)) return false;
			dimensions = [width, height];
			sawImage = true;
		} else if (type === "VP8L") {
			if (length < 5 || bytes[dataStart] !== 0x2f) return false;
			const width = 1 + ((bytes[dataStart + 1] | (bytes[dataStart + 2] << 8)) & 0x3fff);
			const height = 1 + (((bytes[dataStart + 2] >> 6) | (bytes[dataStart + 3] << 2) | (bytes[dataStart + 4] << 10)) & 0x3fff);
			if (!hasSaneDimensions(width, height)) return false;
			dimensions = [width, height];
			sawImage = true;
		} else if (type === "VP8X") {
			const flags = bytes[dataStart];
			if (length < 10 || (flags & 0xc1) !== 0 || (flags & 0x02) !== 0) return false;
			const width = 1 + bytes[dataStart + 4] + (bytes[dataStart + 5] << 8) + (bytes[dataStart + 6] << 16);
			const height = 1 + bytes[dataStart + 7] + (bytes[dataStart + 8] << 8) + (bytes[dataStart + 9] << 16);
			if (!hasSaneDimensions(width, height)) return false;
			dimensions = [width, height];
		} else if (type === "ANIM" || type === "ANMF") {
			return false;
		}

		offset = chunkEnd;
	}

	return sawImage && dimensions !== null && offset === bytes.length;
}

function isPngChunkType(bytes: Uint8Array, offset: number) {
	return bytes.subarray(offset, offset + 4).every((byte) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a));
}

function isKnownPngChunk(type: string) {
	return type === "IHDR" || type === "PLTE" || type === "IDAT" || type === "IEND";
}

function hasSaneDimensions(width: number, height: number) {
	return width > 0 && height > 0 && width <= MAX_LOGO_DIMENSION && height <= MAX_LOGO_DIMENSION && width * height <= MAX_LOGO_PIXELS;
}

function isValidPngBitDepth(bitDepth: number, colorType: number) {
	const valid = {
		0: [1, 2, 4, 8, 16],
		2: [8, 16],
		3: [1, 2, 4, 8],
		4: [8, 16],
		6: [8, 16],
	} as Record<number, number[]>;
	return valid[colorType]?.includes(bitDepth) ?? false;
}

function isJpegFrameMarker(marker: number) {
	return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

function readUint32Be(bytes: Uint8Array, offset: number) {
	return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readUint32Le(bytes: Uint8Array, offset: number) {
	return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + bytes[offset + 3] * 0x1000000;
}

function crc32(bytes: Uint8Array) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function invalidLogo(message: string): WorkspaceBrandLogoUploadResult {
	return { ok: false, message };
}

function detectRasterMimeType(bytes: Uint8Array) {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png" as const;
	}

	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg" as const;
	}

	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp" as const;
	}

	return null;
}

function encodeBase64(bytes: Uint8Array) {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}
