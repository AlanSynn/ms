export const makePdfDocument = (content: string) => {
    const objects = [
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
        '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
        `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(obj => { offsets.push(pdf.length); pdf += `${obj}\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
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

export const makeSimplePdf = (title: string, lines: string[]) => {
    const text = [title, ...lines].slice(0, 46);
    const content = `BT /F1 14 Tf 50 760 Td ${text.map((line, i) => `${i ? '0 -16 Td ' : ''}(${pdfText(line)}) Tj`).join(' ')} ET`;
    return makePdfDocument(content);
};
