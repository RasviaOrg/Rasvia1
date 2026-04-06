import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', 'utf-8');

// Rename TodayBreakdownModal to OverallBreakdownModal
content = content.replace(/function TodayBreakdownModal\(/g, 'function OverallBreakdownModal(');
content = content.replace(/<TodayBreakdownModal/g, '<OverallBreakdownModal');

// Remove Excludes cancelled orders text
content = content.replace(/{totalItems} items sold today/g, '{totalItems} items sold');

// Update modal header text
content = content.replace(/Today's Breakdown/g, 'Overall Breakdown');

writeFileSync('/Users/akshajande/Documents/vs/Rasvia/Rasvia1/components/OwnerHomeContent.tsx', content);
