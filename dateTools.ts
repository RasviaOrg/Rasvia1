export function getStartDate(period: "Today" | "Last Week" | "Last Month" | "All" | "Custom", customDate?: Date | null): string | null {
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

export function getEndDate(period: "Today" | "Last Week" | "Last Month" | "All" | "Custom", customDate?: Date | null): string | null {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    
    switch (period) {
        case "Today":
        case "Last Week":
        case "Last Month":
        case "All":
            return d.toISOString();
        case "Custom":
            if (customDate) {
                const c = new Date(customDate);
                c.setHours(23, 59, 59, 999);
                return c.toISOString();
            }
            return null;
        default:
            return null;
    }
}
