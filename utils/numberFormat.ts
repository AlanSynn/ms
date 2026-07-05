export const finiteNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

export const svgNumber = (value: unknown, fallback = 0): string => {
    const parsed = finiteNumber(value, fallback);
    return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
};
