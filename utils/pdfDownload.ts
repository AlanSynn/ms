/** PDF strings are either the legacy ASCII writer or a binary-safe base64 data URI. */
export const pdfBytes = (source: string): Uint8Array<ArrayBuffer> => {
    if (!source.startsWith('data:application/pdf;base64,')) return new TextEncoder().encode(source);
    const binary = atob(source.slice(source.indexOf(',') + 1));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
};

export const downloadPdf = (name: string, source: string) => {
    const url = URL.createObjectURL(new Blob([pdfBytes(source)], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        link.remove();
        URL.revokeObjectURL(url);
    }
};
