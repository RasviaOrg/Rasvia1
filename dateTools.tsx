export function getStartDate(period: string, customDate?: Date): string | null {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    
    switch (period) {
        case "Today":
            return d.toISOString();
        case "Last Week":
            d.setDate(d.getDate() - 7);
            return d.toISOString();
        case "Last Month":
            d.setMonth(d.getMonth() - 1);
            return d.toISOString();
        case "Custom":
            if (customDate) {
                const c = new Date(customDate);
                c.setHours(0, 0, 0, 0);
                return c.toISOString();
            }
            return null;
        case "All":
        default:
            return null;
    }
}
