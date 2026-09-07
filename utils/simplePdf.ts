export const PDF_POINTS_PER_MM = 72 / 25.4;
export const LETTER_PDF_PAGE = Object.freeze({ width: 612, height: 792 });

export type PdfPageSize = Readonly<{ width: number; height: number }>;
export type PdfDocumentInfo = Readonly<{ title?: string; subject?: string }>;

export const makePdfDocument = (content: string | string[], pageSize: PdfPageSize = LETTER_PDF_PAGE, info?: PdfDocumentInfo) => {
    const pages = Array.isArray(content) && content.length ? content : [Array.isArray(content) ? '' : content];
    const fontObject = pages.length * 2 + 3;
    const pageObjects = pages.map((_, index) => 3 + index * 2);
    const objects = [
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        `2 0 obj << /Type /Pages /Kids [${pageObjects.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj`,
        ...pages.flatMap((pageContent, index) => {
            const pageObject = pageObjects[index];
            const contentObject = pageObject + 1;
            return [
                `${pageObject} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >> endobj`,
                `${contentObject} 0 obj << /Length ${pageContent.length} >> stream\n${pageContent}\nendstream endobj`
            ];
        }),
        `${fontObject} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
        ...(info ? [`${fontObject + 1} 0 obj << ${info.title ? `/Title (${pdfText(info.title)})` : ''} ${info.subject ? `/Subject (${pdfText(info.subject)})` : ''} >> endobj`] : [])
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(obj => { offsets.push(pdf.length); pdf += `${obj}\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R${info ? ` /Info ${fontObject + 1} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
};

export const pdfText = (value: unknown) => String(value)
    .replace(/·/g, '/')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/[()\\]/g, '\\$&')
    .slice(0, 120);

export const num = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '0';

export const circlePath = (x: number, y: number, r: number) => {
    const k = r * 0.5522847498;
    return `${num(x + r)} ${num(y)} m ${num(x + r)} ${num(y + k)} ${num(x + k)} ${num(y + r)} ${num(x)} ${num(y + r)} c ${num(x - k)} ${num(y + r)} ${num(x - r)} ${num(y + k)} ${num(x - r)} ${num(y)} c ${num(x - r)} ${num(y - k)} ${num(x - k)} ${num(y - r)} ${num(x)} ${num(y - r)} c ${num(x + k)} ${num(y - r)} ${num(x + r)} ${num(y - k)} ${num(x + r)} ${num(y)} c h`;
};

export const hexRgb = (value: string | undefined) => {
    const safe = /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value! : '#5a6cff';
    const r = parseInt(safe.slice(1, 3), 16) / 255;
    const g = parseInt(safe.slice(3, 5), 16) / 255;
    const b = parseInt(safe.slice(5, 7), 16) / 255;
    return `${num(r)} ${num(g)} ${num(b)}`;
};

export const SIMPLE_PDF_LINES_PER_PAGE = 44;
export const SIMPLE_PDF_LINE_WIDTH = 88;

export const wrapSimplePdfText = (value: unknown, width = SIMPLE_PDF_LINE_WIDTH): string[] => {
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return [''];
    const lines: string[] = [];
    let current = '';
    const pushWord = (word: string) => {
        if (!current) current = word;
        else if (`${current} ${word}`.length <= width) current = `${current} ${word}`;
        else {
            lines.push(current);
            current = word;
        }
    };
    for (const word of text.split(' ')) {
        if (word.length <= width) {
            pushWord(word);
            continue;
        }
        if (current) {
            lines.push(current);
            current = '';
        }
        for (let offset = 0; offset < word.length; offset += width) {
            const chunk = word.slice(offset, offset + width);
            if (chunk.length === width) lines.push(chunk);
            else current = chunk;
        }
    }
    if (current || !lines.length) lines.push(current);
    return lines;
};

export const makeSimplePdfPageContents = (
    title: string,
    lines: readonly string[],
    linesPerPage = SIMPLE_PDF_LINES_PER_PAGE
) => {
    const wrappedLines = lines.flatMap(line => wrapSimplePdfText(line));
    const pageCount = Math.max(1, Math.ceil(wrappedLines.length / linesPerPage));
    return Array.from({ length: pageCount }, (_, pageIndex) => {
        const pageLines = wrappedLines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage);
        const commands = [
            `BT /F1 14 Tf 50 760 Td (${pdfText(title)}) Tj ET`,
            `BT /F1 8 Tf 50 742 Td (${pdfText(`Page ${pageIndex + 1} of ${pageCount}`)}) Tj ET`,
            ...pageLines.map((line, lineIndex) =>
                `BT /F1 9 Tf 50 ${720 - lineIndex * 14} Td (${pdfText(line)}) Tj ET`
            )
        ];
        return commands.join('\n');
    });
};

export const makeSimplePdf = (title: string, lines: string[]) =>
    makePdfDocument(makeSimplePdfPageContents(title, lines));
